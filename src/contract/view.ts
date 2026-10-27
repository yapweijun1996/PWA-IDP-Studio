import type { Batch, BBox, Value } from './types';
import { REQUIRED_FIELDS } from '../lib/standards';
import { blockingIssues, pointerFor } from './rules';
import { validateBatch } from './validate';

export interface FieldView {
  pointer: string; key: string; value: Value; confidence: number | null;
  evidence: { page: number; bbox: BBox } | null;
  exception: 'missing' | 'low_confidence' | 'invalid' | null;
}
export function transactionView(batch: Batch, transactionId: string) {
  const tx = batch.transactions.find(t => t.transaction_id === transactionId);
  if (!tx) throw new Error('Unknown transaction');
  const doc = batch.documents.find(d => d.document_id === tx.document_id)!;
  const issues = batch.issues.filter(i => i.scope === 'batch' || i.target_id === transactionId || i.target_id === doc.document_id || batch.evidence.some(e => e.evidence_id === i.target_id && e.transaction_id === transactionId));
  const required = tx.required_fields
    ? tx.required_fields.filter(p => /^\/[^/]+$/.test(p)).map(p => p.slice(1).replace(/~1/g, '/').replace(/~0/g, '~'))
    : REQUIRED_FIELDS[doc.document_type];
  const keys = [...new Set([...Object.keys(tx.data).filter(k => k !== 'line_items'), ...required])];
  const fields: FieldView[] = keys.map(key => {
    const pointer = pointerFor(key);
    const ev = batch.evidence.find(e => tx.field_evidence[pointer]?.includes(e.evidence_id));
    const source = ev?.sources[0];
    const missing = required.includes(key) && (tx.data[key] === undefined || tx.data[key] === null || tx.data[key] === '');
    const invalid = issues.some(i => i.status === 'open' && ['INVALID_DECIMAL', 'STANDARDS_ISO8601', 'STANDARDS_ISO4217', 'TOTALS_MISMATCH'].includes(i.rule_code) && i.message.startsWith(`${pointer}:`));
    return { pointer, key, value: tx.data[key] ?? null, confidence: ev?.confidence ?? null, evidence: source ? { page: source.page_number, bbox: source.bbox } : null, exception: missing ? 'missing' : invalid ? 'invalid' : ev && ev.confidence < 0.85 && ev.review_status === 'unreviewed' ? 'low_confidence' : null };
  });
  fields.sort((a, b) => Number(b.exception !== null) - Number(a.exception !== null));
  const blockers = blockingIssues(batch, tx);
  return { documentType: doc.document_type, status: tx.status, fields, lineItems: Array.isArray(tx.data.line_items) ? tx.data.line_items as Record<string, Value>[] : [], issues, pages: batch.pages.map(({ page_number, width, height, status }) => ({ page_number, width, height, status })), canApprove: tx.status !== 'approved' && !blockers.length && doc.boundary_status === 'confirmed' && validateBatch(batch).ok, blockingCount: blockers.length };
}
export function batchSummary(batches: readonly Batch[]) {
  return {
    pages: batches.reduce((n, b) => n + b.pages.length, 0),
    documents: batches.reduce((n, b) => n + b.documents.length, 0),
    transactions: batches.reduce((n, b) => n + b.transactions.length, 0),
    reviewQueue: batches.reduce((n, b) => n + b.transactions.filter(tx => tx.status === 'review_required').length, 0),
  };
}
