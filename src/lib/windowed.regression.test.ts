import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fakeStream } from './fakeStream';
import { runWindowedExtraction, type WindowedOptions } from './windowed';
import { imageLimits } from './providers';
import { segmentPages, type SegmentPlan } from './agent/segment';
import { validateBatch } from '../contract/validate';
import type { RenderedPage } from './pdf';

const { extractPages: MAX_EXTRACT_PAGES, singlePassPages: SINGLE_PASS_PAGES, window: SEGMENT_WINDOW } = imageLimits('openai');
beforeEach(() => { vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ token: 'dmo_test', expires_at: '2099-01-01T00:00:00Z' }), { status: 201 })); });
afterEach(() => { vi.restoreAllMocks(); });
const range = (start: number, end: number) => Array.from({ length: end - start + 1 }, (_, i) => start + i);
const decisions = (pages: number[], boundaries = [1]) => JSON.stringify({ pages: pages.map(page => ({ page, document_type: 'unknown', starts_new_document: boundaries.includes(page), confidence: 1 })) });
const output = (page: number) => JSON.stringify({ document_type: 'unknown', fields: [{ key: 'reference', value: `ref-${page}`, page, bbox: [0, 0, 100, 100], confidence: 1 }], line_items: [] });
function setup(count: number, replies: string[]) {
  let calls = 0, alive = 0, peak = 0, rendered = 0, released = 0, disposed = 0;
  const images: RenderedPage[] = [];
  const stream = fakeStream(replies);
  const source = { pageCount: count,
    async render(page: number) { const image: RenderedPage = { page, width: 10, height: 10, data: 'AAAA', mimeType: 'image/jpeg' }; images.push(image); rendered++; peak = Math.max(peak, ++alive); return image; },
    async textItems() { return []; },
    async release(pages: RenderedPage[]) { released += pages.length; alive -= pages.length; },
    async dispose() { disposed++; },
  };
  const opts: WindowedOptions = { batchId: 'b', createdAt: '2026-10-27T00:00:00Z', file: { file_id: 'f', filename: 'many.pdf', media_type: 'application/pdf', sha256: 'a'.repeat(64), size: 10 }, manifest: range(1, count).map(page_number => ({ page_number, width: 10, height: 10 })), settings: { provider: 'openai', keys: { openai: 'test' }, models: {}, maxPages: 20 }, pageSource: source,
    streamFn: (...args) => {
      expect((JSON.stringify(args[1]).match(/"type":"image"/g) ?? []).length).toBeLessThanOrEqual(imageLimits(opts.settings.provider).requestImages);
      calls++; return stream(...args);
    },
    onProgress: p => { expect(validateBatch(p.batch)).toMatchObject({ ok: true }); },
  };
  return { opts, source, images, stats: () => ({ calls, alive, peak, rendered, released, disposed }) };
}

it('repairs invalid segmentation JSON once and labels absolute window pages', async () => {
  const s = setup(11, ['not json', decisions(range(1, 10)), decisions([10, 11])]);
  const stream = s.opts.streamFn!;
  const prompts: string[] = [];
  s.opts.streamFn = (model, context, options) => { prompts.push(JSON.stringify(context)); return stream(model, context, options); };
  const plan = await segmentPages({ ...s.opts, source: s.source });
  expect(plan.failed).toEqual([]);
  expect(plan.windows.map(w => w.pages)).toEqual([range(1, 10), [10, 11]]);
  expect(s.stats().calls).toBe(3);
  expect(prompts[0]).toContain('Page 1:');
  expect(prompts[2]).toContain('Page 11:');
  expect(s.stats().alive).toBe(0);
});

it('rejects out-of-window decisions and isolates a failed window while later windows continue', async () => {
  const s = setup(20, [decisions([99]), decisions([99]), decisions(range(10, 19), [11]), decisions([19, 20]), output(11)]);
  const result = await runWindowedExtraction(s.opts);
  expect(result.plan.failed).toEqual(range(1, 10));
  expect(result.batch.pages.filter(p => p.status === 'error').map(p => p.page_number)).toEqual(range(1, 10));
  expect(result.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(11, 20)]);
  expect(s.stats().calls).toBe(5);
});

it('resumes only failed windows and failed segments with exact model call counts', async () => {
  const s = setup(20, ['bad', 'bad', decisions(range(10, 19), [11]), decisions([19, 20]), 'bad', 'bad']);
  const first = await runWindowedExtraction(s.opts);
  expect(first.results.map(r => r.output)).toEqual([null]);
  expect(s.stats().calls).toBe(6);
  const retry = setup(20, [decisions(range(1, 10)), output(1), output(11)]);
  const second = await runWindowedExtraction({ ...retry.opts, plan: first.plan, results: first.results });
  expect(retry.stats().calls).toBe(3);
  expect(second.plan.failed).toEqual([]);
  expect(second.results.every(r => r.output !== null)).toBe(true);
  expect(second.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(1, 10), range(11, 20)]);
  await runWindowedExtraction({ ...retry.opts, plan: second.plan, results: second.results });
  expect(retry.stats().calls).toBe(3);
});

it('drops successful results whose page lists change after failed-window resegmentation', async () => {
  const s = setup(20, [decisions(range(1, 10)), output(1), output(11), output(13)]);
  const plan: SegmentPlan = { pageCount: 20, window: imageLimits('openai').window, windows: [{ pages: range(1, 10), decisions: [], error: 'failed' }, { pages: range(10, 19), decisions: range(10, 19).map(page => ({ page, document_type: 'unknown', starts_new_document: page === 13, confidence: 1 })) }, { pages: [19, 20], decisions: [19, 20].map(page => ({ page, document_type: 'unknown', starts_new_document: false, confidence: 1 })) }], segments: [{ pages: [11, 12], document_type: 'unknown', boundary_status: 'confirmed', confidence: 1 }, { pages: range(13, 20), document_type: 'unknown', boundary_status: 'confirmed', confidence: 1 }], failed: range(1, 10), unassigned: [] };
  const result = await runWindowedExtraction({ ...s.opts, plan, results: [{ pages: [11, 12], output: { document_type: 'unknown', fields: [], line_items: [] } }, { pages: range(13, 20), output: { document_type: 'unknown', fields: [], line_items: [] } }] });
  expect(result.results.map(r => r.pages)).toEqual([range(13, 20), range(1, 12)]);
  expect(result.batch.documents.map(d => d.page_refs.map(p => p.page_number)).flat().sort((a, b) => a - b)).toEqual(range(1, 20));
  expect(s.stats().calls).toBe(3);
});

it('aborts between windows without further model calls and releases images', async () => {
  const controller = new AbortController();
  const s = setup(20, [decisions(range(1, 10))]);
  const partial = await runWindowedExtraction({ ...s.opts, signal: controller.signal, onProgress: p => { expect(validateBatch(p.batch).ok).toBe(true); controller.abort(); } });
  expect(partial.batch.batch.status).toBe('review_required');
  expect(partial.batch.pages.every(p => p.status === 'pending')).toBe(true);
  expect(partial.plan.windows).toHaveLength(1);
  expect(s.stats().calls).toBe(1);
  expect(s.stats().alive).toBe(0);
  expect(s.stats().released).toBe(s.stats().rendered);
});

it('propagates AbortError from rendering instead of recording a failed segment', async () => {
  const s = setup(11, [decisions(range(1, 10)), decisions([10, 11])]);
  const render = s.source.render;
  let renders = 0;
  s.source.render = async page => { if (++renders > 14) throw new DOMException('cancelled', 'AbortError'); return render(page); };
  await expect(runWindowedExtraction(s.opts)).rejects.toMatchObject({ name: 'AbortError' });
  expect(s.stats().calls).toBe(2);
  expect(s.stats().alive).toBe(0);
});

it('applies Targeted profile independently to every document', async () => {
  const s = setup(11, [decisions(range(1, 10), [1, 6]), decisions([10, 11]), output(1), output(6)]);
  const result = await runWindowedExtraction({ ...s.opts, profile: { id: 'p', name: 'Reference', fields: [{ key: 'reference', label: 'Reference', type: 'code', required: true }], rowFields: [] } });
  expect(result.batch.transactions.map(t => t.data)).toEqual([{ reference: 'ref-1' }, { reference: 'ref-6' }]);
  expect(result.batch.transactions.map(t => t.required_fields)).toEqual([['/reference'], ['/reference']]);
  expect(s.stats().calls).toBe(4);
});

it('chunks long segments in order and offsets row evidence and profile pointers', async () => {
  const rowOutput = (page: number) => JSON.stringify({ document_type: 'unknown', fields: [{ key: 'reference', value: String(page), page, bbox: [0, 0, 100, 100], confidence: 1 }], line_items: [{ sku: { value: `sku-${page}`, page, bbox: [0, 0, 100, 100], confidence: 1 } }] });
  const count = MAX_EXTRACT_PAGES + 1;
  const s = setup(count, [decisions(range(1, SEGMENT_WINDOW)), decisions(range(SEGMENT_WINDOW, count)), rowOutput(1), rowOutput(MAX_EXTRACT_PAGES + 1)]);
  const result = await runWindowedExtraction({ ...s.opts, profile: { id: 'p', name: 'Rows', fields: [{ key: 'reference', label: 'Reference', type: 'code' }], rowFields: [{ key: 'sku', label: 'SKU', type: 'code', required: true }] } });
  const tx = result.batch.transactions[0];
  expect(tx.data.reference).toBe('1');
  expect(tx.data.line_items).toEqual([{ sku: 'sku-1' }, { sku: `sku-${count}` }]);
  expect(tx.required_fields).toEqual(['/line_items/0/sku', '/line_items/1/sku']);
  expect(result.batch.evidence.filter(e => e.field_pointer.startsWith('/line_items/')).map(e => [e.field_pointer, e.sources[0].page_number])).toEqual([['/line_items/0/sku', 1], ['/line_items/1/sku', count]]);
  expect(s.stats()).toMatchObject({ calls: 4, alive: 0, peak: MAX_EXTRACT_PAGES });
  expect(s.stats().released).toBe(s.stats().rendered);
  expect(s.images.every(image => image.data === '')).toBe(true);
});

it('expands statement rows after chunk merge and resumes without altering cached outputs', async () => {
  const count = MAX_EXTRACT_PAGES + 1;
  const rowOutput = (page: number) => JSON.stringify({ document_type: 'statement', fields: page === 1 ? [{ key: 'closing_balance', value: '20.00', page, bbox: [0, 0, 100, 100], confidence: 1 }] : [], line_items: [{ description: { value: `Entry page ${page}`, page, bbox: [100, 100, 200, 200], confidence: 1 }, amount: { value: '10.00', page, bbox: [100, 100, 200, 200], confidence: 1 }, balance: { value: page === 1 ? '10.00' : '20.00', page, bbox: [100, 100, 200, 200], confidence: 1 } }] });
  const s = setup(count, [decisions(range(1, SEGMENT_WINDOW)), decisions(range(SEGMENT_WINDOW, count)), rowOutput(1), rowOutput(count)]);
  const result = await runWindowedExtraction(s.opts);
  expect(result.batch.documents[0].transaction_ids).toEqual(['t_1', 't_1_entry_1', 't_1_entry_2']);
  expect(result.batch.transactions.map(t => t.data)).toEqual([{ closing_balance: '20.00' }, { description: 'Entry page 1', amount: '10.00', balance: '10.00' }, { description: `Entry page ${count}`, amount: '10.00', balance: '20.00' }]);
  expect(result.results[0].output!.line_items).toEqual(result.batch.transactions.slice(1).map(t => t.data));
  expect(result.results[0].output!.rowEvidence!.map(e => [e.row, e.page])).toEqual([[0, 1], [0, 1], [0, 1], [1, count], [1, count], [1, count]]);
  const snapshot = structuredClone(result.results);
  const retry = setup(count, []);
  const resumed = await runWindowedExtraction({ ...retry.opts, plan: result.plan, results: result.results });
  expect(resumed.batch.transactions).toEqual(result.batch.transactions);
  expect(resumed.results).toEqual(snapshot);
  expect(result.results).toEqual(snapshot);
  expect(retry.stats().calls).toBe(0);
  expect(validateBatch(resumed.batch).ok).toBe(true);
});

it('uses unchanged single pass without segmentation and releases caller-owned images', async () => {
  const s = setup(SINGLE_PASS_PAGES, [output(1)]);
  const result = await runWindowedExtraction(s.opts);
  expect(result.plan.windows).toEqual([]);
  expect(result.batch.documents[0].page_refs.map(p => p.page_number)).toEqual(range(1, SINGLE_PASS_PAGES));
  expect(s.stats()).toEqual({ calls: 1, alive: 0, peak: SINGLE_PASS_PAGES, rendered: SINGLE_PASS_PAGES, released: SINGLE_PASS_PAGES, disposed: 0 });
  expect(s.images.every(image => image.data === '')).toBe(true);
});

it('emits valid progress when the first window has no segments', async () => {
  const s = setup(11, [decisions([]), decisions([10, 11]), output(11)]);
  const snapshots: number[] = [];
  const result = await runWindowedExtraction({ ...s.opts, onProgress: p => {
    expect(validateBatch(p.batch).ok).toBe(true);
    snapshots.push(p.batch.documents.length);
  } });
  expect(snapshots).toEqual([0, 0, 1]);
  expect(result.batch.pages.filter(p => p.unassigned_reason === 'unknown').map(p => p.page_number)).toEqual(range(1, 10));
});

it('isolates an extraction failure and continues later segments before retrying only the failure', async () => {
  const s = setup(11, [decisions(range(1, 10), [1, 6]), decisions([10, 11]), 'bad', 'bad', output(6)]);
  const first = await runWindowedExtraction(s.opts);
  expect(first.batch.pages.filter(p => p.status === 'error').map(p => p.page_number)).toEqual(range(1, 5));
  expect(first.batch.documents[0].page_refs.map(p => p.page_number)).toEqual(range(6, 11));
  expect(s.stats().calls).toBe(5);
  const retry = setup(11, [output(1)]);
  const result = await runWindowedExtraction({ ...retry.opts, plan: first.plan, results: first.results });
  expect(retry.stats().calls).toBe(1);
  expect(result.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(1, 5), range(6, 11)]);
  expect(result.batch.pages.every(p => p.status === 'classified')).toBe(true);
});

it('aborts inside a model call without repair or subsequent windows', async () => {
  const controller = new AbortController();
  const s = setup(11, ['bad']);
  const stream = s.opts.streamFn!;
  const partial = await runWindowedExtraction({ ...s.opts, signal: controller.signal, streamFn: (...args) => {
    controller.abort();
    return stream(...args);
  } });
  expect(partial.batch.batch.status).toBe('review_required');
  expect(partial.results).toEqual([]);
  expect(s.stats().calls).toBe(1);
  expect(s.stats().released).toBe(s.stats().rendered);
  expect(s.stats().alive).toBe(0);
});

it('limits segmentation to the prefix and processes additional pages when the limit is raised', async () => {
  const first = setup(25, [decisions(range(1, 10), [1, 6]), decisions(range(10, 12), [11]), output(1), output(6), output(11)]);
  first.opts.settings.maxPages = 12;
  const limited = await runWindowedExtraction(first.opts);
  expect(limited.plan.pageCount).toBe(12);
  expect(limited.batch.pages.filter(p => p.status === 'classified').map(p => p.page_number)).toEqual(range(1, 12));
  expect(limited.batch.pages.filter(p => p.status === 'pending').map(p => p.page_number)).toEqual(range(13, 25));
  expect(limited.batch.issues.some(i => i.rule_code === 'PAGE_LIMIT_EXCEEDED' && i.status === 'open')).toBe(true);
  const retry = setup(25, [decisions(range(10, 19), [11, 16]), decisions(range(19, 25), [21]), output(11), output(16), output(21)]);
  retry.opts.settings.maxPages = 25;
  const complete = await runWindowedExtraction({ ...retry.opts, plan: limited.plan, results: limited.results });
  expect(complete.batch.pages.every(p => p.status === 'classified')).toBe(true);
  expect(complete.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(1, 5), range(6, 10), range(11, 15), range(16, 20), range(21, 25)]);
  expect(retry.stats().calls).toBe(5);
});

it('keeps completed documents on cancellation and resumes only the remaining document', async () => {
  const controller = new AbortController();
  const first = setup(11, [decisions(range(1, 10), [1, 6]), decisions([10, 11]), output(1)]);
  const partial = await runWindowedExtraction({ ...first.opts, signal: controller.signal, onProgress: p => {
    if (p.phase === 'extracting' && p.done === 1) controller.abort();
  } });
  expect(partial.batch.batch.status).toBe('review_required');
  expect(partial.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(1, 5)]);
  expect(partial.batch.pages.filter(p => p.status === 'pending').map(p => p.page_number)).toEqual(range(6, 11));
  const retry = setup(11, [output(6)]);
  const complete = await runWindowedExtraction({ ...retry.opts, plan: partial.plan, results: partial.results });
  expect(retry.stats().calls).toBe(1);
  expect(complete.batch.documents.map(d => d.page_refs.map(p => p.page_number))).toEqual([range(1, 5), range(6, 11)]);
  expect(complete.batch.pages.every(p => p.status === 'classified')).toBe(true);
});

it('does not re-segment the final overlap page when a cached full window ends at the limit', async () => {
  const first = setup(19, [decisions(range(1, 10), [1, 6]), decisions(range(10, 19), [11, 16]), output(1), output(6), output(11), output(16)]);
  const complete = await runWindowedExtraction(first.opts);
  const retry = setup(19, []);
  const restored = await runWindowedExtraction({ ...retry.opts, plan: complete.plan, results: complete.results });
  expect(retry.stats().calls).toBe(0);
  expect(restored.batch.documents.map(d => d.page_refs)).toEqual(complete.batch.documents.map(d => d.page_refs));
  expect(restored.batch.pages.every(p => p.status === 'classified')).toBe(true);
});

it.each([false, true])('merges three demo chunks with merged required-header checks (missing=%s)', async missing => {
  const replies = [1, 3, 5].map(page => JSON.stringify({ document_type: 'unknown', fields: page === 1 && !missing ? [{ key: 'reference', value: 'HEADER', page, bbox: [0, 0, 100, 100], confidence: 1 }] : [], line_items: [{ sku: { value: `sku-${page}`, page, bbox: [0, 0, 100, 100], confidence: 1 } }] }));
  const s = setup(5, [decisions([1, 2, 3, 4]), decisions([4, 5]), ...replies]);
  s.opts.settings.provider = 'demo';
  const prompts: string[] = [];
  const stream = s.opts.streamFn!;
  s.opts.streamFn = (model, context, options) => { prompts.push(JSON.stringify(context)); return stream(model, context, options); };
  const result = await runWindowedExtraction({ ...s.opts, profile: { id: 'p', name: 'Rows', fields: [{ key: 'reference', label: 'Reference', type: 'code', required: true }], rowFields: [{ key: 'sku', label: 'SKU', type: 'code', required: true }] } });
  expect(result.plan.window).toBe(4);
  expect(result.plan.windows.map(w => w.pages)).toEqual([[1, 2, 3, 4], [4, 5]]);
  expect(result.batch.documents).toHaveLength(1);
  expect(result.batch.transactions[0].data).toEqual({ reference: missing ? null : 'HEADER', line_items: [{ sku: 'sku-1' }, { sku: 'sku-3' }, { sku: 'sku-5' }] });
  expect(result.batch.issues.filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.message)).toEqual(missing ? ['/reference: required field is missing.'] : []);
  expect(result.batch.transactions[0].required_fields).toEqual(['/reference', '/line_items/0/sku', '/line_items/1/sku', '/line_items/2/sku']);
  expect(prompts[3]).toContain('Earlier pages of this same document');
  expect(s.stats().calls).toBe(5);
});

it('re-segments when the stored window differs', async () => {
  const first = setup(5, [output(1)]);
  const stored = await runWindowedExtraction(first.opts);
  const retry = setup(5, [decisions([1, 2, 3, 4]), decisions([4, 5]), output(1), output(3), output(5)]);
  retry.opts.settings.provider = 'demo';
  const result = await runWindowedExtraction({ ...retry.opts, plan: stored.plan, results: stored.results });
  expect(result.plan.window).toBe(4);
  expect(result.plan.windows.map(w => w.pages)).toEqual([[1, 2, 3, 4], [4, 5]]);
  expect(retry.stats().calls).toBe(5);
});

it.each(['openai', 'openrouter', 'gemini'] as const)('segments %s with ten-page windows', async provider => {
  const s = setup(11, [decisions(range(1, 10)), decisions([10, 11])]);
  s.opts.settings.provider = provider;
  s.opts.settings.keys = { [provider]: 'test' };
  const plan = await segmentPages({ ...s.opts, source: s.source });
  expect(plan.window).toBe(imageLimits(provider).window);
  expect(plan.windows.map(w => w.pages)).toEqual([range(1, 10), [10, 11]]);
});

it('does not add header-only data from later demo chunks', async () => {
  const s = setup(5, [decisions([1, 2, 3, 4]), decisions([4, 5]), output(1), output(3), output(5)]);
  s.opts.settings.provider = 'demo';
  const result = await runWindowedExtraction({ ...s.opts, profile: { id: 'p', name: 'Header', fields: [{ key: 'reference', label: 'Reference', type: 'code', required: true }], rowFields: [] } });
  expect(result.batch.transactions[0].data).toEqual({ reference: 'ref-1' });
  expect(result.batch.evidence.map(e => e.sources[0].page_number)).toEqual([1]);
  expect(result.batch.issues.filter(i => i.rule_code === 'MISSING_REQUIRED')).toEqual([]);
});
