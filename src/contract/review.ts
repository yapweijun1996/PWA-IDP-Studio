import type { Batch, Value, ReviewAction, Transaction } from './types';
import { canonicalValue } from './build';
import { blockingIssues, decimalKey, pointerFor, refreshIssues, rollup } from './rules';
import { validateBatch } from './validate';
import { normalizeDecimal } from './decimal';
import { ruleCatalogEntry } from './ruleCatalog';

export function recomputeIssues(batch: Batch): Batch {
  return refreshIssues(structuredClone(batch));
}
function assertValid(batch: Batch): Batch {
  const result = validateBatch(batch);
  if (!result.ok) throw new Error(result.errors.map(e => e.code).join(', '));
  return batch;
}
function appendReview(batch: Batch, transactionId: string, action: ReviewAction, reason: string) {
  const tx = batch.transactions.find(t => t.transaction_id === transactionId);
  if (!tx) throw new Error('Unknown transaction');
  const prior = tx.revision;
  tx.revision++;
  batch.batch.revision++;
  batch.reviews.push({ review_id: `review_${crypto.randomUUID()}`, target_type: 'transaction', target_id: transactionId, action, actor_id: 'local_user', at: new Date().toISOString(), reason, prior_revision: prior, new_revision: tx.revision });
}
/** A typed value as it is stored: decimals normalized, integers as numbers, invalid text kept so review can flag it. */
function normalizeCell(tx: Transaction, pointer: string, key: string, newValue: Value): Value {
  const type = tx.field_types?.[pointer];
  let value = canonicalValue(tx.field_types ? '' : key, newValue);
  if (value !== null && value !== '') {
    if (type === 'amount' || type === 'quantity') value = normalizeDecimal(value) ?? value;
    if (type === 'integer' && (typeof value === 'string' || typeof value === 'number') && /^-?\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value))) value = Number(value);
  }
  return value;
}
export function correctField(batch: Batch, transactionId: string, pointer: string, newValue: Value, reason: string): Batch {
  const next = structuredClone(batch);
  const tx = next.transactions.find(t => t.transaction_id === transactionId);
  if (!tx) throw new Error('Unknown transaction');
  if (!/^\/(?:[^~]|~[01])*$/.test(pointer)) throw new Error('Invalid field pointer');
  const keys = pointer.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'));
  let parent: Value = tx.data;
  for (const key of keys.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !Object.hasOwn(parent, key)) throw new Error('Unknown field parent');
    parent = (parent as Record<string, Value>)[key];
  }
  const key = keys[keys.length - 1];
  if (!parent || typeof parent !== 'object' || keys.some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) throw new Error('Invalid field pointer');
  if (Array.isArray(parent) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= parent.length)) throw new Error('Invalid array index');
  const value = normalizeCell(tx, pointer, key, newValue);
  Object.defineProperty(parent, key, { value, writable: true, enumerable: true, configurable: true });
  for (const ev of next.evidence.filter(e => e.transaction_id === transactionId && e.field_pointer === pointer)) {
    ev.value = value;
    ev.review_status = 'corrected';
    ev.method = 'human';
  }
  tx.status = 'validated'; // A correction invalidates approval of the prior revision.
  appendReview(next, transactionId, 'correct', reason);
  return assertValid(refreshIssues(next));
}
export type CellType = NonNullable<Transaction['field_types']>[string];
/** One column of a transaction's rows. `type` and `required` matter for a Targeted result, which declares both per cell. */
export interface RowColumn { key: string; label?: string; type?: CellType; required?: boolean }
const ROW_ADDED_PREFIX = 'Row added by hand: row ';
const ROW_ADDED = /^Row added by hand: row (\d+)\./;
/**
 * Zero-based indexes of the rows a person added to a transaction. The contract gives evidence at least one page region, and a
 * row typed in by hand has none, so the review trail is the record: Add Row writes it, and rows are only ever appended, so an
 * index never moves.
 */
export function handEnteredRows(batch: Batch, transactionId: string): Set<number> {
  return new Set(batch.reviews.flatMap(r => {
    const match = r.target_type === 'transaction' && r.target_id === transactionId && r.action === 'correct' ? ROW_ADDED.exec(r.reason) : null;
    return match ? [Number(match[1]) - 1] : [];
  }));
}
/**
 * Append a row to a transaction's `line_items`, entered by hand (`values` by column key; blank cells stay null). The row takes
 * the declared type and required mark of its column so it is validated like the rows read from the page, an approval of the
 * earlier revision is withdrawn, and the review trail records who added it and why. Totals and every other rule run again.
 */
export function addRow(batch: Batch, transactionId: string, columns: readonly RowColumn[], values: Readonly<Record<string, string>>, reason: string): Batch {
  const next = structuredClone(batch);
  const tx = next.transactions.find(t => t.transaction_id === transactionId);
  if (!tx) throw new Error('Unknown transaction');
  const rows = tx.data.line_items;
  if (!Array.isArray(rows)) throw new Error('This transaction has no rows to add to');
  if (!reason.trim()) throw new Error('Enter a reason');
  if (!columns.length || new Set(columns.map(c => c.key)).size !== columns.length || columns.some(c => !c.key || ['__proto__', 'prototype', 'constructor'].includes(c.key))) throw new Error('Invalid row columns');
  const index = rows.length;
  const typeOf = (key: string) => rows.map((_, i) => tx.field_types?.[`/line_items/${i}${pointerFor(key)}`]).find(type => type !== undefined);
  const row: Record<string, Value> = {};
  for (const column of columns) {
    const pointer = `/line_items/${index}${pointerFor(column.key)}`;
    const text = (values[column.key] ?? '').trim();
    if (tx.field_types) tx.field_types[pointer] = column.type ?? typeOf(column.key) ?? 'text';
    // INVALID_DECIMAL is an error, not a blocker, and the totals rule skips a row whose amount is not a number, so text typed into
    // a number column would slip through approval. A row typed by hand is refused at the door instead.
    const cellType = tx.field_types?.[pointer];
    const numeric = tx.field_types ? cellType === 'amount' || cellType === 'quantity' : decimalKey(column.key);
    if (text !== '' && numeric && normalizeDecimal(text) === null) throw new Error(`${column.label ?? column.key}: enter a number, for example 1250.50`);
    row[column.key] = text === '' ? null : normalizeCell(tx, pointer, column.key, text);
  }
  if (Object.values(row).every(v => v === null)) throw new Error('Enter at least one value');
  if (tx.required_fields) {
    const suffixes = new Set(tx.required_fields.flatMap(p => { const match = /^\/line_items\/\d+(\/.*)$/.exec(p); return match ? [match[1]] : []; }));
    for (const column of columns) if (column.required) suffixes.add(pointerFor(column.key));
    for (const suffix of suffixes) { const pointer = `/line_items/${index}${suffix}`; if (!tx.required_fields.includes(pointer)) tx.required_fields.push(pointer); }
  }
  rows.push(row);
  tx.status = 'validated'; // Adding a row invalidates approval of the prior revision.
  appendReview(next, transactionId, 'correct', `${ROW_ADDED_PREFIX}${index + 1}. ${reason.trim()}`);
  return assertValid(refreshIssues(next));
}
export type ApprovalResult = { ok: true; batch: Batch } | { ok: false; error: string };
export function approveTransaction(batch: Batch, transactionId: string, reason: string): ApprovalResult {
  const next = recomputeIssues(batch);
  const tx = next.transactions.find(t => t.transaction_id === transactionId);
  if (!tx) return { ok: false, error: 'Unknown transaction' };
  const doc = next.documents.find(d => d.document_id === tx.document_id);
  if (blockingIssues(next, tx).length || doc?.boundary_status !== 'confirmed' || !validateBatch(next).ok) return { ok: false, error: 'Resolve blocking issues before approval' };
  if (tx.status === 'approved') return { ok: false, error: 'Transaction is already approved' };
  appendReview(next, transactionId, 'approve', reason);
  tx.status = 'approved';
  return { ok: true, batch: assertValid(rollup(next)) };
}

function reviewIssue(batch: Batch, issueId: string, reason: string, reopen: boolean): Batch {
  const explanation = reason.trim();
  if (explanation.length < 10) throw new Error('Enter a reason of at least 10 characters');
  const next = structuredClone(batch);
  const issue = next.issues.find(i => i.issue_id === issueId);
  if (!issue) throw new Error('Unknown issue');
  if (!ruleCatalogEntry(issue.rule_code)?.waivable) throw new Error('Mandatory integrity rules cannot be waived');
  if (issue.status !== (reopen ? 'waived' : 'open')) throw new Error(reopen ? 'Issue is not waived' : 'Issue is not open');
  const prior = next.batch.revision++;
  const reviewId = `review_${crypto.randomUUID()}`;
  next.reviews.push({ review_id: reviewId, target_type: 'issue', target_id: issueId, action: reopen ? 'reject' : 'waive', actor_id: 'local_user', at: new Date().toISOString(), reason: explanation, prior_revision: prior, new_revision: next.batch.revision });
  issue.status = reopen ? 'open' : 'waived';
  issue.waiver_review_id = reopen ? null : reviewId;
  return assertValid(refreshIssues(next));
}
export const waiveIssue = (batch: Batch, issueId: string, reason: string): Batch => reviewIssue(batch, issueId, reason, false);
export const reopenIssue = (batch: Batch, issueId: string, reason: string): Batch => reviewIssue(batch, issueId, reason, true);
