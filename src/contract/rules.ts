import type { Batch, Issue, Transaction, Value } from './types';
import { normalizeDecimal, sumDecimals, decimalEquals } from './decimal';
import { REQUIRED_FIELDS, isIsoDate, isIsoCurrency } from '../lib/standards';
import { validateBatch, exportEligibleTransactions } from './validate';
import { ruleCatalogEntry } from './ruleCatalog';

export const pointerFor = (key: string) => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
export const decimalKey = (key: string) => /(amount|price|total|quantity)/i.test(key) || /^(debit|credit|(?:opening_|closing_|running_)?balance)$/.test(key);
export function businessIssues(batch: Batch): Issue[] {
  const issues: Issue[] = [];
  const add = (scope: Issue['scope'], target_id: string, rule_code: string, severity: Issue['severity'], message: string) => {
    issues.push({ issue_id: `issue_${issues.length + 1}`, scope, target_id, rule_code, severity, message, status: 'open', waiver_review_id: null });
  };
  const pending = batch.pages.filter(p => p.status === 'pending');
  if (pending.length) add('batch', batch.batch.batch_id, 'PAGE_LIMIT_EXCEEDED', 'blocking', `${batch.pages.length - pending.length} of ${batch.pages.length} pages processed; unprocessed pages: ${pending.map(p => p.page_number).join(', ')}.`);
  const failed = batch.pages.filter(p => p.status === 'error');
  if (failed.length) add('batch', batch.batch.batch_id, 'PAGES_FAILED', 'blocking', `Pages failed: ${failed.map(p => p.page_number).join(', ')}.`);
  for (const doc of batch.documents) if (doc.boundary_status === 'needs_review') add('document', doc.document_id, 'BOUNDARY_UNCERTAIN', 'blocking', 'Document boundary needs review.');
  for (const tx of batch.transactions) {
    const doc = batch.documents.find(d => d.document_id === tx.document_id)!;
    const entry = tx.transaction_type === 'statement_entry';
    const required = tx.required_fields ?? (entry ? [] : REQUIRED_FIELDS[doc.document_type].map(pointerFor));
    if (entry && ![tx.data.amount, tx.data.total_amount, tx.data.debit, tx.data.credit, tx.data.description].some(v => v !== undefined && v !== null && String(v).trim() !== '')) add('transaction', tx.transaction_id, 'MISSING_REQUIRED', 'blocking', '/amount: entry needs an amount or description.');
    for (const pointer of required) {
      let value: Value | undefined = tx.data;
      for (const part of pointer.slice(1).split('/')) {
        const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
        value = value !== null && typeof value === 'object' && Object.hasOwn(value, key) ? (value as Record<string, Value>)[key] : undefined;
      }
      if (value === undefined || value === null || value === '') add('transaction', tx.transaction_id, 'MISSING_REQUIRED', 'blocking', `${pointer}: required field is missing.`);
    }
    const walk = (value: Record<string, Value>, prefix = '') => {
      for (const [key, v] of Object.entries(value)) {
        const pointer = prefix + pointerFor(key);
        const type = tx.field_types?.[pointer];
        const present = v !== null && v !== '';
        if ((tx.field_types ? present && (type === 'amount' || type === 'quantity') : decimalKey(key) && (!entry || present)) && normalizeDecimal(v) === null) add('transaction', tx.transaction_id, 'INVALID_DECIMAL', 'error', `${pointer}: invalid decimal.`);
        if ((tx.field_types ? present && type === 'date' : (key.endsWith('_date') && (!entry || present)) || (entry && key === 'date' && present)) && !isIsoDate(v)) add('transaction', tx.transaction_id, 'STANDARDS_ISO8601', 'blocking', `${pointer}: not ISO 8601.`);
        if (present && type === 'integer' && (typeof v !== 'number' || !Number.isSafeInteger(v))) add('transaction', tx.transaction_id, 'INVALID_INTEGER', 'blocking', `${pointer}: not an integer.`);
        if (!tx.field_types && key === 'currency' && !isIsoCurrency(v)) add('transaction', tx.transaction_id, 'STANDARDS_ISO4217', 'blocking', `${pointer}: not ISO 4217.`);
        if (Array.isArray(v)) v.forEach((row, i) => { if (row && typeof row === 'object' && !Array.isArray(row)) walk(row, `${pointer}/${i}`); });
      }
    };
    walk(tx.data);
    const rows = tx.data.line_items;
    const total = normalizeDecimal(tx.data.total_amount);
    if (!tx.field_types && total !== null && Array.isArray(rows) && rows.length) {
      const amounts = rows.map(row => row && typeof row === 'object' && !Array.isArray(row) ? normalizeDecimal(row.amount) : null);
      if (amounts.every((v): v is string => v !== null) && !decimalEquals(sumDecimals(amounts), total)) add('transaction', tx.transaction_id, 'TOTALS_MISMATCH', 'blocking', '/total_amount: line amounts do not match total.');
    }
    for (const key of Object.keys(tx.data).filter(k => k !== 'line_items')) {
      const pointer = pointerFor(key);
      if (!tx.field_evidence[pointer]?.length) add('transaction', tx.transaction_id, 'FIELD_WITHOUT_EVIDENCE', 'info', `${pointer}: no bounding box evidence.`);
    }
  }
  for (const doc of batch.documents) {
    const transactions = batch.transactions.filter(t => t.document_id === doc.document_id);
    const header = transactions.find(t => t.transaction_type !== 'statement_entry');
    const entries = transactions.filter(t => t.transaction_type === 'statement_entry');
    const closing = normalizeDecimal(header?.data.closing_balance);
    const balances = entries.map(t => normalizeDecimal(t.data.running_balance ?? t.data.balance));
    if (header && closing !== null && balances.length && balances.every((v): v is string => v !== null) && !decimalEquals(balances[balances.length - 1]!, closing)) add('transaction', header.transaction_id, 'TOTALS_MISMATCH', 'blocking', '/closing_balance: final running balance does not match closing balance.');
  }
  for (const ev of batch.evidence) if (ev.confidence < 0.85 && ev.review_status === 'unreviewed') add('evidence', ev.evidence_id, 'LOW_CONFIDENCE', 'warning', `${ev.field_pointer}: confidence below 0.85.`);
  return issues;
}

export function blockingIssues(batch: Batch, tx: Transaction): Issue[] {
  const doc = batch.documents.find(d => d.document_id === tx.document_id);
  return batch.issues.filter(i => i.status === 'open' && i.severity === 'blocking' && (
    i.scope === 'batch' || (i.scope === 'transaction' && i.target_id === tx.transaction_id) ||
    (i.scope === 'document' && i.target_id === tx.document_id) ||
    (i.scope === 'evidence' && batch.evidence.some(e => e.evidence_id === i.target_id && e.transaction_id === tx.transaction_id)) ||
    (i.scope === 'file' && doc?.page_refs.some(p => p.file_id === i.target_id)) ||
    (i.scope === 'page' && doc?.page_refs.some(p => `${p.file_id}:${p.page_number}` === i.target_id))
  ));
}
export function rollup(batch: Batch): Batch {
  for (const tx of batch.transactions) {
    if (blockingIssues(batch, tx).length) tx.status = 'review_required';
    else if (tx.status !== 'approved') tx.status = 'validated';
  }
  for (const doc of batch.documents) {
    const txs = batch.transactions.filter(tx => tx.document_id === doc.document_id);
    doc.status = doc.boundary_status !== 'confirmed' || txs.some(tx => tx.status === 'review_required') ? 'review_required' : txs.length && txs.every(tx => tx.status === 'approved') ? 'approved' : 'validated';
  }
  const approved = batch.transactions.filter(tx => tx.status === 'approved').length;
  batch.batch.status = batch.documents.some(d => d.status === 'review_required') || batch.issues.some(i => i.scope === 'batch' && i.status === 'open' && i.severity === 'blocking') ? 'review_required' : approved === batch.transactions.length && approved > 0 ? 'approved' : approved > 0 ? 'partially_approved' : 'validated';
  batch.validation.export_eligible_transaction_ids = [];
  const result = validateBatch(batch);
  batch.validation = {
    structural_valid: !result.errors.some(e => e.code === 'SCHEMA'),
    reference_valid: !result.errors.some(e => /ORPHAN|REF|UNKNOWN|DUPLICATE|POINTER|OUTSIDE|FIELD_EVIDENCE/.test(e.code)),
    coverage_valid: !result.errors.some(e => /COVERAGE|UNASSIGNED|BBOX/.test(e.code)),
    business_rules_valid: !batch.issues.some(i => i.status === 'open' && (i.severity === 'blocking' || i.severity === 'error')),
    export_eligible_transaction_ids: result.ok ? exportEligibleTransactions(batch) : [],
    validated_at: new Date().toISOString(), validator_version: '1.0.0',
  };
  return batch;
}

const sameIssue = (a: Issue, b: Issue) => a.scope === b.scope && a.target_id === b.target_id && a.rule_code === b.rule_code && a.message === b.message;
export function refreshIssues(batch: Batch): Batch {
  const current = businessIssues(batch);
  for (const old of batch.issues) if (old.status === 'open' && ruleCatalogEntry(old.rule_code)?.autoResolves && !current.some(i => sameIssue(i, old))) old.status = 'resolved';
  for (const issue of current) {
    if (batch.issues.some(old => sameIssue(old, issue) && (old.status === 'open' || old.status === 'waived'))) continue;
    let n = batch.issues.length + 1;
    while (batch.issues.some(i => i.issue_id === `issue_${n}`)) n++;
    batch.issues.push({ ...issue, issue_id: `issue_${n}` });
  }
  return rollup(batch);
}
