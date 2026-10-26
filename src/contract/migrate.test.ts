import { expect, it } from 'vitest';
import { migrateV1Record } from './migrate';
import { invoiceInput } from './fixtures';
import { validateBatch } from './validate';
import type { DocumentRecord } from '../lib/types';

export function legacyRecord(): DocumentRecord {
  return { id: 'old_1', name: 'receipt.png', mime: 'image/png', size: 100, createdAt: Date.parse('2026-10-26T00:00:00Z'), pageCount: 1, envelope: {
    schema_version: '1.0', document_id: 'old_1', document_type: 'receipt', status: 'approved',
    extraction: { amount: 12.5, currency: 'SGD', line_items: [{ amount: 12.5, quantity: 1 }] },
    evidence: { amount: { page: 1, bbox: [0.1, 0.2, 0.3, 0.4], confidence: 0.8 } },
    validation: { schema_valid: true, totals_match: null, missing_required: [], low_confidence: [], standards_issues: [], needs_review: false }, model: null,
    audit: [{ at: '2026-10-26T01:00:00Z', action: 'extracted' }, { at: '2026-10-26T02:00:00Z', action: 'field_edited', field: 'amount', from: 10, to: 12.5 }, { at: '2026-10-26T03:00:00Z', action: 'approved' }],
  } };
}
it('migrates decimal amounts, real boxes, field corrections and explicit human approval', () => {
  const old = legacyRecord();
  const snapshot = structuredClone(old);
  const input = invoiceInput();
  const batch = migrateV1Record(old, { file: input.file, pages: input.pages });
  expect(old).toEqual(snapshot);
  expect(batch.batch.batch_id).toBe('legacy_old_1');
  expect(batch.documents[0].document_type).toBe('unknown');
  expect(batch.transactions[0]).toMatchObject({ status: 'approved', data: { amount: '12.5', line_items: [{ amount: '12.5', quantity: '1' }] } });
  expect(batch.reviews.map(r => [r.action, r.actor_id])).toEqual([['correct', 'legacy_user'], ['approve', 'legacy_user']]);
  expect(batch.evidence[0]).toMatchObject({ method: 'human', review_status: 'corrected', sources: [{ bbox: { x: 0.1, y: 0.2 } }] });
  expect(batch.evidence[0].sources[0].bbox.width).toBeCloseTo(0.2);
  expect(batch.issues.find(i => i.rule_code === 'LEGACY_TYPE_UNMAPPED')).toMatchObject({ severity: 'warning', status: 'open' });
  expect(validateBatch(batch).ok).toBe(true);
});
it('maps other to unknown, retains mapped types and does not invent approval', () => {
  for (const type of ['other', 'sales_invoice'] as const) {
    const old = legacyRecord(); old.envelope.document_type = type; old.envelope.status = 'ready';
    const input = invoiceInput();
    const batch = migrateV1Record(old, { file: input.file, pages: input.pages, dimensionsFallback: true });
    expect(batch.documents[0].document_type).toBe(type === 'other' ? 'unknown' : type);
    expect(batch.transactions[0].status).not.toBe('approved');
    expect(batch.reviews.some(r => r.action === 'approve')).toBe(false);
    expect(batch.issues.some(i => i.rule_code === 'LEGACY_TYPE_UNMAPPED')).toBe(type === 'other');
    expect(batch.issues.find(i => i.rule_code === 'LEGACY_DIMENSIONS_FALLBACK')).toMatchObject({ severity: 'info' });
    expect(validateBatch(batch).ok).toBe(true);
  }
});
