import type { Batch, Value, ReviewAction } from './types';
import { canonicalValue } from './build';
import { blockingIssues, refreshIssues, rollup } from './rules';
import { validateBatch } from './validate';
import { normalizeDecimal } from './decimal';

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
  const type = tx.field_types?.[pointer];
  let value = canonicalValue(tx.field_types ? '' : key, newValue);
  if (value !== null && value !== '') {
    if (type === 'amount' || type === 'quantity') value = normalizeDecimal(value) ?? value;
    if (type === 'integer' && (typeof value === 'string' || typeof value === 'number') && /^-?\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value))) value = Number(value);
  }
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
