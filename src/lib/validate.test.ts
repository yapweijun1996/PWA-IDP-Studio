import { describe, expect, it } from 'vitest';
import { normalizeWireBox } from './bbox';
import { buildEnvelope, checkModelOutput, cleanJson, parseModelJson, totalsMatch } from './validate';

describe('normalizeWireBox', () => {
  it('converts [ymin,xmin,ymax,xmax]/1000 to [x0,y0,x1,y1] in 0..1', () => {
    expect(normalizeWireBox([100, 200, 300, 600])).toEqual([0.2, 0.1, 0.6, 0.3]);
  });
  it('rejects malformed and degenerate boxes', () => {
    expect(normalizeWireBox(null)).toBeNull();
    expect(normalizeWireBox([1, 2, 3])).toBeNull();
    expect(normalizeWireBox([500, 500, 500, 900])).toBeNull();
    expect(normalizeWireBox(['a', 1, 2, 3])).toBeNull();
  });
  it('clamps out-of-range values', () => {
    expect(normalizeWireBox([-50, 0, 2000, 1000])).toEqual([0, 0, 1, 1]);
  });
});

const good = {
  document_type: 'purchase_invoice',
  fields: [
    { key: 'supplier_name', value: 'ABC Trading Pte Ltd', page: 1, bbox: [80, 120, 110, 260], confidence: 0.98 },
    { key: 'invoice_no', value: 'INV-2026-1042', page: 1, bbox: [80, 300, 110, 420], confidence: 0.99 },
    { key: 'invoice_date', value: '2026-10-26', page: 1, bbox: null, confidence: 0.96 },
    { key: 'currency', value: 'SGD', page: 1, bbox: null, confidence: 0.99 },
    { key: 'total_amount', value: '1,280.00', page: 1, bbox: [900, 700, 930, 800], confidence: 0.72 },
  ],
  line_items: [{ description: 'Office Supplies', quantity: 10, unit_price: 128, amount: 1280 }],
};

describe('buildEnvelope', () => {
  const env = buildEnvelope('doc_1', checkModelOutput(good), { provider: 'demo', model: 'demo-auto' });
  it('coerces amounts and flags low confidence for review', () => {
    expect(env.extraction.total_amount).toBe(1280);
    expect(env.validation.low_confidence).toEqual(['total_amount']);
    expect(env.validation.totals_match).toBe(true);
    expect(env.status).toBe('review_required');
  });
  it('never produces approved from model output', () => {
    expect(env.status).not.toBe('approved');
  });
  it('clean JSON has no evidence', () => {
    expect(cleanJson(env)).not.toHaveProperty('evidence');
    expect(cleanJson(env)).toHaveProperty('invoice_no', 'INV-2026-1042');
  });
  it('flags missing required fields', () => {
    const e = buildEnvelope('d', checkModelOutput({ ...good, fields: good.fields.slice(0, 2) }), null);
    expect(e.validation.missing_required).toContain('total_amount');
  });
});

describe('totalsMatch', () => {
  it('detects mismatches and unknowns', () => {
    expect(totalsMatch({ total_amount: 100, line_items: [{ amount: 90 }] })).toBe(false);
    expect(totalsMatch({ line_items: [{ amount: 90 }] })).toBeNull();
  });
});

describe('parsing', () => {
  it('extracts JSON from fenced prose', () => {
    expect(parseModelJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('rejects bad output', () => {
    expect(() => parseModelJson('no json')).toThrow();
    expect(() => checkModelOutput({ document_type: 'nope', fields: [] })).toThrow(/document_type/);
  });
});
