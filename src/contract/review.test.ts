import { describe, expect, it } from 'vitest';
import { invoiceInput } from './fixtures';
import { buildBatch } from './build';
import { approveTransaction, correctField, recomputeIssues, waiveIssue, reopenIssue } from './review';
import { validateBatch } from './validate';

describe('audited issue waivers', () => {
  it('preserves a waiver through recomputation and audits reopening', () => {
    const original = buildBatch(invoiceInput());
    const issue = original.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    const waived = waiveIssue(original, issue.issue_id, 'Verified against original source');
    expect(original.issues.find(i => i.issue_id === issue.issue_id)?.status).toBe('open');
    const next = recomputeIssues(waived);
    expect(next.issues.filter(i => i.issue_id === issue.issue_id)).toEqual([expect.objectContaining({ status: 'waived', waiver_review_id: next.reviews.at(-1)!.review_id })]);
    expect(next.reviews.at(-1)).toMatchObject({ action: 'waive', target_type: 'issue', target_id: issue.issue_id });
    const reopened = reopenIssue(next, issue.issue_id, 'New evidence requires another review');
    expect(reopened.issues.find(i => i.issue_id === issue.issue_id)).toMatchObject({ status: 'open', waiver_review_id: null });
    expect(reopened.reviews.at(-1)).toMatchObject({ action: 'reject', target_id: issue.issue_id });
  });
  it('requires a meaningful reason and refuses mandatory rules', () => {
    const input = invoiceInput();
    input.output.fields = input.output.fields.filter(f => f.key !== 'supplier_name');
    const batch = buildBatch(input);
    const missing = batch.issues.find(i => i.rule_code === 'MISSING_REQUIRED')!;
    const low = batch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    expect(() => waiveIssue(batch, missing.issue_id, 'Reviewed original source')).toThrow(/cannot be waived/);
    expect(() => waiveIssue(batch, low.issue_id, ' short ')).toThrow(/10 characters/);
  });
  it('removes a waived reconciliation blocker from export eligibility', () => {
    const input = invoiceInput();
    input.output.fields.find(f => f.key === 'total_amount')!.value = '50';
    const batch = buildBatch(input);
    const issue = batch.issues.find(i => i.rule_code === 'TOTALS_MISMATCH')!;
    expect(batch.validation.export_eligible_transaction_ids).toEqual([]);
    const next = waiveIssue(batch, issue.issue_id, 'Authorized reconciliation exception');
    expect(next.validation.export_eligible_transaction_ids).toContain('t_1');
    expect(reopenIssue(next, issue.issue_id, 'Reconciliation exception withdrawn').validation.export_eligible_transaction_ids).toEqual([]);
  });
  it.each([waiveIssue, reopenIssue])('rejects unknown issues, unknown rules and short reasons without mutating input', operation => {
    const batch = buildBatch(invoiceInput());
    const snapshot = structuredClone(batch);
    expect(() => operation(batch, 'missing', 'Reviewed original source')).toThrow('Unknown issue');
    const low = batch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    expect(() => operation(batch, low.issue_id, '          ')).toThrow(/10 characters/);
    low.rule_code = 'UNKNOWN_RULE';
    expect(() => operation(batch, low.issue_id, 'Reviewed original source')).toThrow(/cannot be waived/);
    low.rule_code = 'LOW_CONFIDENCE';
    expect(batch).toEqual(snapshot);
  });
  it('rejects repeat waivers, reopening open issues and decisions on resolved issues', () => {
    const batch = buildBatch(invoiceInput());
    const low = batch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    expect(() => reopenIssue(batch, low.issue_id, 'Reviewed original source')).toThrow('Issue is not waived');
    const waived = waiveIssue(batch, low.issue_id, 'Reviewed original source');
    const snapshot = structuredClone(waived);
    expect(() => waiveIssue(waived, low.issue_id, 'Reviewed original source')).toThrow('Issue is not open');
    expect(waived).toEqual(snapshot);
    low.status = 'resolved';
    expect(() => waiveIssue(batch, low.issue_id, 'Reviewed original source')).toThrow('Issue is not open');
    expect(() => reopenIssue(batch, low.issue_id, 'Reviewed original source')).toThrow('Issue is not waived');
  });
  it.each(['SCHEMA', 'ORPHAN_TRANSACTION', 'PAGE_MANIFEST_COVERAGE', 'MISSING_REQUIRED', 'BOUNDARY_UNCERTAIN', 'PAGES_FAILED', 'EXTRACTION_FAILED'])('never waives or reopens mandatory rule %s', code => {
    const batch = buildBatch(invoiceInput());
    const issue = batch.issues[0];
    issue.rule_code = code;
    expect(() => waiveIssue(batch, issue.issue_id, 'Reviewed original source')).toThrow(/cannot be waived/);
    issue.status = 'waived';
    expect(() => reopenIssue(batch, issue.issue_id, 'Reviewed original source')).toThrow(/cannot be waived/);
  });
  it('audits the exact reason, actor and revision transition and preserves earlier decisions', () => {
    const batch = buildBatch(invoiceInput());
    const evidence = batch.issues.find(i => i.rule_code === 'FIELD_WITHOUT_EVIDENCE')!;
    const waived = waiveIssue(batch, evidence.issue_id, '  Checked source manually  ');
    expect(waived.batch.revision).toBe(batch.batch.revision + 1);
    expect(waived.reviews.at(-1)).toMatchObject({
      action: 'waive', actor_id: 'local_user', reason: 'Checked source manually',
      prior_revision: batch.batch.revision, new_revision: waived.batch.revision,
      target_type: 'issue', target_id: evidence.issue_id,
    });
    expect(Number.isNaN(Date.parse(waived.reviews.at(-1)!.at))).toBe(false);
    const reopened = reopenIssue(waived, evidence.issue_id, 'Source needs another inspection');
    expect(reopened.reviews.slice(0, -1)).toEqual(waived.reviews);
    expect(reopened.batch.revision).toBe(waived.batch.revision + 1);
    expect(validateBatch(reopened).ok).toBe(true);
  });
  it('refuses decisions on structurally invalid batches without changing them', () => {
    const batch = buildBatch(invoiceInput());
    batch.source_files[0].page_count = 2;
    const low = batch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    const snapshot = structuredClone(batch);
    expect(() => waiveIssue(batch, low.issue_id, 'Reviewed original source')).toThrow('PAGE_MANIFEST_COVERAGE');
    expect(batch).toEqual(snapshot);
    low.status = 'waived';
    expect(() => reopenIssue(batch, low.issue_id, 'Reviewed original source')).toThrow('PAGE_MANIFEST_COVERAGE');
  });
});
describe('immutable batch reviews', () => {
  it('corrects, resolves, approves and invalidates approval on the next edit', () => {
    const input = invoiceInput();
    input.output.fields.find(f => f.key === 'total_amount')!.value = '50';
    const original = buildBatch(input);
    const snapshot = structuredClone(original);
    expect(approveTransaction(original, 't_1', 'Reviewed')).toMatchObject({ ok: false });
    const fixed = correctField(original, 't_1', '/total_amount', '1280.00', 'Checked original');
    expect(original).toEqual(snapshot);
    expect(fixed.transactions[0]).toMatchObject({ revision: 2, status: 'validated', data: { total_amount: '1280.00' } });
    expect(fixed.evidence.find(e => e.field_pointer === '/total_amount')).toMatchObject({ value: '1280.00', method: 'human', review_status: 'corrected' });
    expect(fixed.issues.find(i => i.rule_code === 'TOTALS_MISMATCH')).toMatchObject({ status: 'resolved' });
    expect(fixed.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')).toMatchObject({ status: 'resolved' });
    expect(fixed.reviews[0]).toMatchObject({ action: 'correct', actor_id: 'local_user', prior_revision: 1, new_revision: 2, reason: 'Checked original' });
    const result = approveTransaction(fixed, 't_1', 'Reviewed original');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.batch.transactions[0].status).toBe('approved');
    expect(result.batch.documents[0].status).toBe('approved');
    expect(result.batch.batch.status).toBe('approved');
    expect(result.batch.reviews[1]).toMatchObject({ action: 'approve', prior_revision: 2, new_revision: 3 });
    const edited = correctField(result.batch, 't_1', '/invoice_no', 'NEW-1', 'Corrected number');
    expect(edited.transactions[0].status).toBe('validated');
    for (const b of [original, fixed, result.batch, edited, recomputeIssues(edited)]) expect(validateBatch(b).ok).toBe(true);
  });
  it('creates missing values without fabricating evidence and preserves issue history on recurrence', () => {
    const input = invoiceInput(); input.output.fields = input.output.fields.filter(f => f.key !== 'supplier_name');
    const b = buildBatch(input);
    const fixed = correctField(b, 't_1', '/supplier_name', 'Vendor', 'Read original');
    expect(fixed.transactions[0].field_evidence['/supplier_name']).toBeUndefined();
    expect(fixed.issues.find(i => i.rule_code === 'MISSING_REQUIRED')?.status).toBe('resolved');
    const recurrent = correctField(fixed, 't_1', '/supplier_name', '', 'Clear incorrect value');
    expect(recurrent.issues.filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.status)).toEqual(['resolved', 'open']);
    expect(validateBatch(recurrent).ok).toBe(true);
  });
  it('corrects line-item decimals with pointer traversal and refuses invalid pointers', () => {
    const b = buildBatch(invoiceInput());
    const fixed = correctField(b, 't_1', '/line_items/0/amount', '1,280.00', 'Checked line');
    expect(fixed.transactions[0].data.line_items).toMatchObject([{ amount: '1280.00' }]);
    expect(validateBatch(fixed).ok).toBe(true);
    for (const pointer of ['/__proto__/polluted', '/line_items/9/amount', '/bad~pointer']) expect(() => correctField(b, 't_1', pointer, 'x', 'Invalid')).toThrow();
  });
  it('preserves waived and resolved history without duplicating current issues', () => {
    const b = buildBatch(invoiceInput());
    const low = b.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
    low.status = 'waived';
    const next = recomputeIssues(b);
    expect(next.issues).toEqual(b.issues);
    expect(next).not.toBe(b);
    expect(validateBatch(next).ok).toBe(true);
  });
  it('rejects approval for a batch-level page limit or unknown transaction', () => {
    const input = invoiceInput(); input.pages.push({ page_number: 2, width: 595, height: 842 });
    const b = buildBatch(input);
    expect(approveTransaction(b, 't_1', 'Reviewed')).toMatchObject({ ok: false });
    expect(approveTransaction(b, 'missing', 'Reviewed')).toMatchObject({ ok: false });
  });
});
