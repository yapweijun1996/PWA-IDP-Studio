import { expect, it } from 'vitest';
import { buildBatchFromSegments } from './build';
import { validateBatch } from './validate';
import { refreshIssues } from './rules';

it('preserves explicit document coverage, isolates foreign evidence and resolves managed issues', () => {
  const batch = buildBatchFromSegments({ batchId: 'segments', createdAt: '2026-10-27T00:00:00Z', file: { file_id: 'f', filename: 'many.pdf', media_type: 'application/pdf', sha256: 'a'.repeat(64), size: 10 }, pages: Array.from({ length: 5 }, (_, i) => ({ page_number: i + 1, width: 10, height: 10 })), model: null, failedPages: [4], segments: [1, 2, 3].map(page => ({ pages: [page], boundary_status: page === 2 ? 'needs_review' : 'confirmed', output: { document_type: 'unknown', fields: [{ key: 'reference', value: String(page), page, bbox: [0, 0, 100, 100], confidence: 1 }, { key: 'foreign', value: 'wrong', page: 5, bbox: [0, 0, 100, 100], confidence: 1 }], line_items: [] } })) });
  expect(validateBatch(batch).ok).toBe(true);
  expect(batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([[1], [2], [3]]);
  expect(batch.pages.map(p => p.status)).toEqual(['classified', 'classified', 'classified', 'error', 'pending']);
  expect(batch.evidence.map(e => [e.document_id, e.sources[0].page_number])).toEqual([['d_1', 1], ['d_2', 2], ['d_3', 3]]);
  expect(batch.issues.filter(i => ['PAGES_FAILED', 'BOUNDARY_UNCERTAIN', 'PAGE_LIMIT_EXCEEDED'].includes(i.rule_code)).map(i => i.rule_code).sort()).toEqual(['BOUNDARY_UNCERTAIN', 'PAGES_FAILED', 'PAGE_LIMIT_EXCEEDED']);
  batch.documents[1].boundary_status = 'confirmed';
  refreshIssues(batch);
  expect(batch.issues.find(i => i.rule_code === 'BOUNDARY_UNCERTAIN')?.status).toBe('resolved');
});
