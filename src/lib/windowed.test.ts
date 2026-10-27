import { expect, it } from 'vitest';
import { fakeStream } from './fakeStream';
import { runWindowedExtraction } from './windowed';
import { stitchSegments, type SegmentWindow } from './agent/segment';
import { validateBatch } from '../contract/validate';
import type { Settings } from './settings';

const settings: Settings = { provider: 'openai', keys: { openai: 'test' }, models: {}, maxPages: 20 };
const decision = (page: number, starts_new_document = false, confidence = 1) => ({ page, starts_new_document, confidence, document_type: 'unknown' as const });
it('stitches overlap, gaps, uncertain boundaries and maximal segmentation', () => {
  const windows: SegmentWindow[] = [{ pages: [1, 2, 3], decisions: [decision(1), decision(2, true, .5), decision(3)] }, { pages: [3, 4, 5], decisions: [decision(3, true), decision(5)] }];
  expect(stitchSegments(windows, 5)).toEqual([
    { pages: [1], document_type: 'unknown', confidence: 1, boundary_status: 'confirmed' },
    { pages: [2, 3], document_type: 'unknown', confidence: .5, boundary_status: 'needs_review' },
    { pages: [5], document_type: 'unknown', confidence: 1, boundary_status: 'confirmed' },
  ]);
  expect(stitchSegments([{ pages: [1, 2, 3], decisions: [1, 2, 3].map(p => decision(p)) }], 3)[0].pages).toEqual([1, 2, 3]);
  expect(stitchSegments([{ pages: [1, 2, 3], decisions: [1, 2, 3].map(p => decision(p, true)) }], 3).map(s => s.pages)).toEqual([[1], [2], [3]]);
});
it('extracts five documents with absolute evidence and valid progress snapshots', async () => {
  const windows = [[1, 10], [10, 19], [19, 25]].map(([start, end]) => JSON.stringify({ pages: Array.from({ length: end - start + 1 }, (_, n) => decision(start + n, (start + n - 1) % 5 === 0, start + n === 11 ? .5 : 1)) }));
  const outputs = [1, 6, 11, 16, 21].map(page => JSON.stringify({ document_type: 'unknown', fields: [{ key: 'reference', value: String(page), page, bbox: [0, 0, 100, 100], confidence: 1 }], line_items: [] }));
  let calls = 0;
  const stream = fakeStream([...windows, ...outputs]);
  const opts = { batchId: 'b', createdAt: '2026-10-27T00:00:00Z', file: { file_id: 'f', filename: 'many.pdf', media_type: 'application/pdf' as const, sha256: 'a'.repeat(64), size: 10 }, manifest: Array.from({ length: 25 }, (_, n) => ({ page_number: n + 1, width: 10, height: 10 })), settings, pageSource: { pageCount: 25, async render(page: number) { return { page, width: 10, height: 10, data: 'AAAA', mimeType: 'image/jpeg' as const }; }, async textItems() { return []; }, async dispose() {} }, streamFn: (...args: Parameters<typeof stream>) => { calls++; return stream(...args); }, onProgress: ({ batch }: { batch: Parameters<typeof validateBatch>[0] }) => { expect(validateBatch(batch).ok).toBe(true); } };
  const result = await runWindowedExtraction(opts);
  expect(result.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15], [16, 17, 18, 19, 20], [21, 22, 23, 24, 25]]);
  expect(result.batch.issues.filter(i => i.rule_code === 'BOUNDARY_UNCERTAIN').map(i => i.target_id)).toEqual(['d_3']);
  expect(result.batch.evidence.map(e => e.sources[0].page_number)).toEqual([1, 6, 11, 16, 21]);
  expect(calls).toBe(8);
  await runWindowedExtraction({ ...opts, plan: result.plan, results: result.results });
  expect(calls).toBe(8);
});
