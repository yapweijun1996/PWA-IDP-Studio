import { describe, expect, it } from 'vitest';
import { runExtraction } from './extract';
import { fakeStream } from './fakeStream';
import type { Settings } from './settings';

const settings: Settings = { provider: 'openai', keys: { openai: 'sk-test' }, models: {} };
const pages = [{ page: 1, width: 10, height: 10, data: 'AAAA', mimeType: 'image/jpeg' as const }];
const valid = JSON.stringify({
  document_type: 'sales_order',
  fields: [{ key: 'order_no', value: 'SO-1', page: 1, bbox: [1, 2, 30, 40], confidence: 0.9 }],
  line_items: [],
});

describe('runExtraction harness', () => {
  it('returns an envelope from a valid reply', async () => {
    const env = await runExtraction({ documentId: 'd1', pages, settings, streamFn: fakeStream([valid]) });
    expect(env.document_type).toBe('sales_order');
    expect(env.evidence.order_no.bbox).toEqual([0.002, 0.001, 0.04, 0.03]);
    expect(env.model).toEqual({ provider: 'openai', model: 'gpt-5.4-mini' });
  });
  it('repairs once after an invalid reply', async () => {
    const env = await runExtraction({ documentId: 'd2', pages, settings, streamFn: fakeStream(['not json', valid]) });
    expect(env.document_id).toBe('d2');
  });
  it('fails after a second invalid reply', async () => {
    await expect(
      runExtraction({ documentId: 'd3', pages, settings, streamFn: fakeStream(['nope', 'still nope']) }),
    ).rejects.toThrow(/not valid/);
  });
  it('requires a BYOK key', async () => {
    await expect(
      runExtraction({ documentId: 'd4', pages, settings: { ...settings, keys: {} }, streamFn: fakeStream([valid]) }),
    ).rejects.toThrow();
  });
});
