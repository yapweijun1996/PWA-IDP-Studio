import { describe, expect, it } from 'vitest';
import { checkProfileOutput } from '../validate';
import { runExtraction } from '../extract';
import { fakeStream } from '../fakeStream';
import type { ExtractionProfile } from './contract';
import type { Settings } from '../settings';
import { validateBatch } from '../../contract/validate';
import { correctField, recomputeIssues } from '../../contract/review';

const profile: ExtractionProfile = { id: 'test', name: 'Selected columns', fields: [
  { key: 'reference', label: 'Reference', type: 'code', required: true },
  { key: 'balance', label: 'Balance', type: 'amount' },
  { key: 'dated', label: 'Date', type: 'date' },
  { key: 'count', label: 'Count', type: 'integer' },
], rowFields: [{ key: 'sku', label: 'SKU', type: 'code', required: true }, { key: 'units', label: 'Units', type: 'quantity' }] };
const cell = (value: unknown) => ({ value, page: 1, bbox: [100, 100, 200, 300], confidence: 0.95 });
const input = () => ({ document_type: 'unknown', fields: [
  { key: 'reference', ...cell(null) }, { key: 'balance', ...cell('1,234.50') },
  { key: 'dated', ...cell('2026/10/27') }, { key: 'count', ...cell('003') },
], line_items: [{ sku: cell(null), units: cell('2,000.25') }] });
const settings: Settings = { provider: 'openai', keys: { openai: 'test' }, models: {}, maxPages: 20 };

describe('targeted extraction', () => {
  it('normalizes selected types and generic row cells without adding auto fields', () => {
    const output = checkProfileOutput(input(), profile);
    expect(Object.fromEntries(output.fields.map(f => [f.key, f.value]))).toEqual({ reference: null, balance: '1234.50', dated: '2026-10-27', count: 3 });
    expect(output.line_items).toEqual([{ sku: null, units: '2000.25' }]);
    expect(output.requiredPointers).toEqual(['/reference', '/line_items/0/sku']);
  });
  it('rejects unselected header, row, and top-level keys', () => {
    expect(() => checkProfileOutput({ ...input(), fields: [...input().fields, { key: 'extra', ...cell('x') }] }, profile)).toThrow(/Unexpected field: extra/);
    expect(() => checkProfileOutput({ ...input(), line_items: [{ sku: cell('x'), extra: cell('y') }] }, profile)).toThrow(/Unexpected row key: extra/);
    expect(() => checkProfileOutput({ ...input(), status: 'approved' }, profile)).toThrow(/Unexpected keys: status/);
  });
  it.each([
    ['balance', '1,23.50', /decimal/], ['dated', '2026-02-30', /ISO 8601/],
    ['dated', '10/11/2026', /ISO 8601/], ['count', '1.5', /integer/], ['count', true, /integer/],
  ])('rejects invalid %s values instead of guessing', (key, value, error) => {
    const raw = input();
    raw.fields = raw.fields.map(f => f.key === key ? { ...f, value } : f);
    expect(() => checkProfileOutput(raw, profile)).toThrow(error as RegExp);
  });
  it('persists required issues, arbitrary row evidence, and typed corrections through the v2 envelope', async () => {
    const batch = await runExtraction({ batchId: 'profile', createdAt: '2026-10-27T00:00:00Z',
      file: { file_id: 'f1', filename: 'test.png', media_type: 'image/png', sha256: 'a'.repeat(64), size: 4 },
      manifest: [{ page_number: 1, width: 100, height: 100 }], pages: [{ page: 1, width: 100, height: 100, mimeType: 'image/jpeg', data: 'AAAA' }],
      settings, profile, streamFn: fakeStream([[{ name: 'submit_result', arguments: { json: input() } }]]),
    });
    expect(validateBatch(batch).ok).toBe(true);
    expect(batch.transactions[0].data.line_items).toEqual([{ sku: null, units: '2000.25' }]);
    expect(batch.evidence.find(e => e.field_pointer === '/line_items/0/units')?.value).toBe('2000.25');
    expect(batch.issues.filter(i => i.rule_code === 'MISSING_REQUIRED' && i.status === 'open').map(i => i.message)).toEqual(['/reference: required field is missing.', '/line_items/0/sku: required field is missing.']);
    const refreshed = recomputeIssues(batch);
    expect(refreshed.transactions[0].status).toBe('review_required');
    expect(refreshed.issues.filter(i => i.rule_code === 'MISSING_REQUIRED' && i.status === 'open')).toHaveLength(2);
    let corrected = correctField(refreshed, 't_1', '/reference', 'REF-1', 'Read original');
    corrected = correctField(corrected, 't_1', '/line_items/0/sku', 'SKU-1', 'Read original');
    corrected = correctField(corrected, 't_1', '/count', '5', 'Read original');
    expect(corrected.transactions[0].data.count).toBe(5);
    expect(corrected.transactions[0].status).toBe('validated');
    expect(corrected.issues.filter(i => i.rule_code === 'MISSING_REQUIRED' && i.status === 'open')).toEqual([]);
    expect(validateBatch(corrected).ok).toBe(true);
  });
  it('omits rows for a header-only profile and rejects row data', () => {
    const headers = { ...profile, rowFields: [] };
    expect(checkProfileOutput({ ...input(), line_items: [] }, headers).includeRows).toBe(false);
    expect(() => checkProfileOutput(input(), headers)).toThrow(/Rows are not allowed/);
  });
});
