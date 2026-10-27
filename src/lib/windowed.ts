import { runExtraction, type ExtractOptions } from './extract';
import { createPageSource, releasePageImages } from './agent/pageSource';
import { getFileByFileId } from './db';
import { segmentPages, stitchSegments, type SegmentPlan } from './agent/segment';
import { buildBatchFromSegments } from '../contract/build';
import { modelFor } from './settings';
import { imageLimits } from './providers';
import type { ModelOutput } from './validate';
import type { Batch } from '../contract/types';
export { BOUNDARY_MIN_CONFIDENCE } from './agent/segment';
export type { Segment, SegmentPlan } from './agent/segment';
export interface SegmentResult { pages: number[]; output: ModelOutput | null; error?: string }
export interface WindowedProgress { phase: 'segmenting' | 'extracting'; done: number; total: number; batch: Batch; plan: SegmentPlan; results: SegmentResult[] }
export type WindowedOptions = Omit<ExtractOptions, 'pages'> & { plan?: SegmentPlan; results?: SegmentResult[]; onProgress?: (progress: WindowedProgress) => void };

export async function runWindowedExtraction(opts: WindowedOptions): Promise<{ batch: Batch; plan: SegmentPlan; results: SegmentResult[] }> {
  opts.signal?.throwIfAborted();
  const blob = opts.blob ?? (!opts.pageSource ? await getFileByFileId(opts.file.file_id) : undefined);
  if (!opts.pageSource && !blob) throw new Error('Original file unavailable');
  const pageCount = Math.min(opts.manifest.length, opts.settings.maxPages);
  const source = opts.pageSource ?? await createPageSource(blob!, { maxPages: pageCount });
  const limits = imageLimits(opts.settings.provider);
  let plan: SegmentPlan = opts.plan?.window === limits.window ? structuredClone(opts.plan) : { pageCount, window: limits.window, windows: [], segments: [], failed: [], unassigned: [] };
  if (plan.pageCount !== pageCount) {
    plan.pageCount = pageCount;
    plan.windows = plan.windows.filter(w => w.pages.every(p => p <= pageCount) && (w.pages.length === limits.window || w.pages.at(-1) === pageCount));
    plan.segments = stitchSegments(plan.windows, pageCount);
    plan.failed = plan.failed.filter(p => p <= pageCount);
    plan.unassigned = plan.unassigned.filter(p => p <= pageCount);
  }
  const results = structuredClone(opts.plan?.window === limits.window ? opts.results ?? [] : []);
  const pruneResults = () => {
    const keys = new Set(plan.segments.map(s => s.pages.join(',')));
    for (let i = results.length - 1; i >= 0; i--) if (!keys.has(results[i].pages.join(','))) results.splice(i, 1);
  };
  const build = () => buildBatchFromSegments({ batchId: opts.batchId, createdAt: opts.createdAt, file: opts.file, pages: opts.manifest, model: { provider: opts.settings.provider, model: modelFor(opts.settings, opts.settings.provider) }, unknownPages: plan.unassigned, segments: plan.segments.flatMap(s => {
    const result = results.find(r => r.pages.join(',') === s.pages.join(','));
    return result?.output ? [{ pages: s.pages, output: result.output, boundary_status: s.boundary_status }] : [];
  }), failedPages: [...plan.failed, ...results.filter(r => !r.output).flatMap(r => r.pages)] });
  const progress = (phase: WindowedProgress['phase'], done: number, total: number) => {
    pruneResults();
    opts.onProgress?.({ phase, done, total, batch: build(), plan: structuredClone(plan), results: structuredClone(results) });
  };
  try {
    if (opts.manifest.length <= limits.singlePassPages) {
      if (results[0]?.output && results[0].pages.length === pageCount) { progress('extracting', 1, 1); return { batch: build(), plan, results }; }
      const pages = [];
      try {
        for (const page of opts.manifest.slice(0, pageCount)) { opts.signal?.throwIfAborted(); pages.push(await source.render(page.page_number)); }
        let output: ModelOutput | null = null;
        const batch = await runExtraction({ ...opts, pages, pageSource: source, onOutput: out => { output = out; opts.onOutput?.(out); } });
        plan.segments = [{ pages: pages.map(p => p.page), document_type: batch.documents[0].document_type, boundary_status: 'confirmed', confidence: 1 }];
        results.splice(0, results.length, { pages: pages.map(p => p.page), output });
        progress('extracting', 1, 1);
        return { batch, plan, results };
      } finally { await releasePageImages(source, pages); }
    }
    plan = await segmentPages({ ...opts, source, plan, onWindow: current => { plan = current; progress('segmenting', plan.windows.length, Math.max(1, Math.ceil((plan.pageCount - 1) / (limits.window - 1)))); } });
    pruneResults();
    for (const [index, segment] of plan.segments.entries()) {
      opts.signal?.throwIfAborted();
      const existing = results.find(r => r.pages.join(',') === segment.pages.join(','));
      if (existing?.output) { progress('extracting', index + 1, plan.segments.length); continue; }
      opts.onStatus?.(`Extracting document ${index + 1}/${plan.segments.length}`);
      const result: SegmentResult = { pages: segment.pages, output: null };
      try {
        let merged: ModelOutput | undefined;
        for (let offset = 0; offset < segment.pages.length; offset += limits.extractPages) {
          opts.signal?.throwIfAborted();
          const absolutePages = segment.pages.slice(offset, offset + limits.extractPages);
          const pages = [];
          try {
            for (const page of absolutePages) { opts.signal?.throwIfAborted(); pages.push(await source.render(page)); }
            let chunk: ModelOutput | undefined;
            await runExtraction({ ...opts, pages, absolutePages, continuation: offset > 0, pageSource: source, onOutput: out => { chunk = out; } });
            if (!chunk) throw new Error('Extraction produced no output');
            if (!merged) merged = chunk;
            else {
              const rowOffset = merged.line_items.length;
              merged.line_items.push(...chunk.line_items);
              merged.rowEvidence = [...(merged.rowEvidence ?? []), ...(chunk.rowEvidence ?? []).map(e => ({ ...e, row: e.row + rowOffset }))];
              for (const pointer of chunk.requiredPointers ?? []) if (pointer.startsWith('/line_items/')) (merged.requiredPointers ??= []).push(pointer.replace(/^\/line_items\/(\d+)/, (_, n) => `/line_items/${Number(n) + rowOffset}`));
              for (const [pointer, type] of Object.entries(chunk.fieldTypes ?? {})) if (pointer.startsWith('/line_items/')) (merged.fieldTypes ??= {})[pointer.replace(/^\/line_items\/(\d+)/, (_, n) => `/line_items/${Number(n) + rowOffset}`)] = type;
            }
          } finally { await releasePageImages(source, pages); }
        }
        result.output = merged!;
      } catch (error) {
        opts.signal?.throwIfAborted();
        if ((error as { name?: string })?.name === 'AbortError') throw error;
        result.error = String(error);
      }
      if (existing) results.splice(results.indexOf(existing), 1);
      results.push(result);
      progress('extracting', index + 1, plan.segments.length);
    }
    return { batch: build(), plan, results };
  } catch (error) {
    if (!opts.signal?.aborted) throw error;
    const batch = build();
    batch.batch.status = 'review_required';
    opts.onProgress?.({ phase: 'extracting', done: results.filter(r => r.output).length, total: plan.segments.length, batch, plan: structuredClone(plan), results: structuredClone(results) });
    return { batch, plan, results };
  } finally { if (!opts.pageSource) await source.dispose(); }
}
