import { describe, expect, it, vi } from 'vitest';
import { runExtraction } from './extract';
import { fakeStream } from './fakeStream';
import type { Settings } from './settings';
import { validateBatch } from '../contract/validate';
import type { PageSource } from './agent/pageSource';
import type { AgentStep } from './agent/contract';

const settings: Settings = { provider: 'openai', keys: { openai: 'sk-test' }, models: {}, maxPages: 20 };
const pages = [{ page: 1, width: 10, height: 10, data: 'AAAA', mimeType: 'image/jpeg' as const }];
const base = { createdAt: '2026-10-26T00:00:00Z', file: { file_id: 'f1', filename: 'order.png', media_type: 'image/png' as const, sha256: 'a'.repeat(64), size: 10 }, manifest: [{ page_number: 1, width: 10, height: 10 }], pages, settings };
const valid = JSON.stringify({ document_type: 'sales_order', fields: [{ key: 'order_no', value: 'SO-1', page: 1, bbox: [1, 2, 30, 40], confidence: 0.9 }], line_items: [] });

describe('runExtraction harness', () => {
  it('returns a batch from a valid reply with normalized evidence', async () => {
    const batch = await runExtraction({ ...base, batchId: 'b1', streamFn: fakeStream([valid]) });
    expect(batch.documents[0].document_type).toBe('sales_order');
    expect(batch.evidence[0].method).toBe('vision_llm');
    expect(batch.evidence[0].sources[0].bbox).toMatchObject({ x: 0.002, y: 0.001 });
    expect(batch.evidence[0].sources[0].bbox.width).toBeCloseTo(0.038);
    expect(batch.evidence[0].sources[0].bbox.height).toBeCloseTo(0.029);
    expect(validateBatch(batch).ok).toBe(true);
  });
  it('repairs once after an invalid reply', async () => {
    const batch = await runExtraction({ ...base, batchId: 'b2', streamFn: fakeStream(['not json', valid]) });
    expect(batch.batch.batch_id).toBe('b2');
    expect(validateBatch(batch).ok).toBe(true);
  });
  it('sanitizes demo payloads on both initial and repair turns through Agent options', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      token: 'dmo_test', expires_at: '2099-01-01T00:00:00Z',
    }), { status: 201 }));
    const reply = fakeStream(['not json', valid]);
    const payloads: unknown[] = [];
    try {
      const batch = await runExtraction({
        ...base, batchId: 'demo-repair', settings: { ...settings, provider: 'demo' },
        streamFn: async (model, context, options) => {
          expect(options?.onPayload).toBeTypeOf('function');
          const input = context.messages;
          const payload = await options!.onPayload!({ model: model.id, input, stream: true, store: true, max_output_tokens: 8192, previous_response_id: 'forbidden' }, model);
          expect(payload).toEqual({ model: model.id, input, stream: true, store: false });
          payloads.push(payload);
          return reply(model, context, options);
        },
      });
      expect(payloads).toHaveLength(2);
      expect(validateBatch(batch).ok).toBe(true);
    } finally {
      fetchMock.mockRestore();
    }
  });
  it('fails after a second invalid reply', async () => {
    await expect(runExtraction({ ...base, batchId: 'b3', streamFn: fakeStream(['nope', 'still nope']) })).rejects.toThrow(/not valid/);
  });
  it('requires a BYOK key', async () => {
    await expect(runExtraction({ ...base, batchId: 'b4', settings: { ...settings, keys: {} }, streamFn: fakeStream([valid]) })).rejects.toThrow();
  });
  it('uses the trusted manifest rather than model claims of complete processing', async () => {
    const batch = await runExtraction({ ...base, batchId: 'b5', manifest: Array.from({ length: 30 }, (_, n) => ({ page_number: n + 1, width: 10, height: 10 })), streamFn: fakeStream([JSON.stringify({ ...JSON.parse(valid), processed_all_pages: true, status: 'approved' })]) });
    expect(batch.pages).toHaveLength(30);
    expect(batch.pages.filter(p => p.status === 'pending')).toHaveLength(29);
    expect(batch.batch.status).toBe('review_required');
    expect(batch.validation.export_eligible_transaction_ids).toEqual([]);
  });
  it('runs crop then submit and feeds tool-result images into the next turn', async () => {
    const source: PageSource = { pageCount: 1, render: vi.fn(async () => pages[0]), textItems: async () => [], dispose: async () => {} };
    const steps: AgentStep[] = [];
    const replies = fakeStream([
      [{ name: 'crop_zoom', arguments: { page: 1, ymin: 100, xmin: 100, ymax: 500, xmax: 500 } }],
      [{ name: 'submit_result', arguments: { json: JSON.parse(valid) } }],
    ]);
    let requests = 0;
    const batch = await runExtraction({ ...base, batchId: 'tool-loop', pageSource: source, onStep: step => steps.push(step), streamFn: (model, context, options) => {
      if (++requests === 2) {
        const result = context.messages.find(m => m.role === 'toolResult');
        expect(result?.content).toContainEqual({ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' });
      }
      return replies(model, context, options);
    } });
    expect(batch.transactions[0].data.order_no).toBe('SO-1');
    expect(batch.transactions[0].status).not.toBe('approved');
    expect(steps.filter(s => s.tool !== 'model').map(s => [s.tool, s.ok])).toEqual([['crop_zoom', true], ['submit_result', true]]);
    expect(steps.filter(s => s.tool === 'model')).toHaveLength(2);
    expect(requests).toBe(2);
  });
  it('lets the model correct a rejected submission in the same loop', async () => {
    const replies = fakeStream([
      [{ name: 'submit_result', arguments: { json: { document_type: 'unknown' } } }],
      [{ name: 'submit_result', arguments: { json: JSON.parse(valid) } }],
    ]);
    let requests = 0;
    const batch = await runExtraction({ ...base, batchId: 'tool-repair', streamFn: (model, context, options) => {
      if (++requests === 2) expect(JSON.stringify(context.messages)).toContain('Invalid result: fields must be an array');
      return replies(model, context, options);
    } });
    expect(batch.transactions[0].data.order_no).toBe('SO-1');
    expect(requests).toBe(2);
  });
  it('stops repeated tool calls at the configured model-turn budget', async () => {
    let requests = 0;
    const replies = fakeStream([[{ name: 'submit_result', arguments: { json: {} } }]]);
    await expect(runExtraction({ ...base, batchId: 'budget', maxSteps: 2, streamFn: (model, context, options) => {
      requests++;
      return replies(model, context, options);
    } })).rejects.toThrow(/max steps \(2\)/);
    expect(requests).toBe(2);
  });
  it('accepts a valid final submission exactly at the step limit', async () => {
    const batch = await runExtraction({ ...base, batchId: 'last-step', maxSteps: 1, streamFn: fakeStream([[{ name: 'submit_result', arguments: { json: JSON.parse(valid) } }]]) });
    expect(batch.transactions[0].data.order_no).toBe('SO-1');
  });
  it('aborts a stalled tool within the wall-clock guard', async () => {
    vi.useFakeTimers();
    try {
      const source: PageSource = { pageCount: 1, render: () => new Promise(() => {}), textItems: async () => [], dispose: async () => {} };
      const pending = runExtraction({ ...base, batchId: 'timeout', timeoutMs: 10, pageSource: source, streamFn: fakeStream([[{ name: 'get_page_image', arguments: { page: 1 } }]]) });
      const assertion = expect(pending).rejects.toThrow(/timed out/);
      await vi.advanceTimersByTimeAsync(11);
      await assertion;
    } finally { vi.useRealTimers(); }
  });
});
