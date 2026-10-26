import { describe, expect, it } from 'vitest';
import { normalizeWireBox } from './bbox';
import schema from '../../docs/envelope.schema.json';
import { buildEnvelope, checkModelOutput, cleanJson, parseModelJson, totalsMatch, validate } from './validate';

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
  it('ignores model approval for both ready and review-required output', () => {
    for (const confidence of [0.99, 0.5]) {
      const output = checkModelOutput({
        ...good, status: 'approved',
        fields: good.fields.map((field) => ({ ...field, confidence })),
      });
      expect(buildEnvelope('d', output, null).status).toBe(
        confidence < 0.85 ? 'review_required' : 'ready',
      );
    }
  });
  it('has exactly the top-level keys required by the envelope schema', () => {
    expect(Object.keys(env).sort()).toEqual([...schema.required].sort());
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

describe('standards validation', () => {
  it.each(['2024-02-29', '2000-02-29', '2026-04-30', '0001-01-01', '9999-12-31'])(
    'accepts real ISO dates: %s', (value) => {
      const result = validate('other', { custom_date: value }, {});
      expect(result.standards_issues).toEqual([]);
      expect(result.needs_review).toBe(false);
    },
  );

  it.each([
    '2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01',
    '2026-01-00', '0000-01-01', '2026-1-01', '26-01-01', '2026-01-01T00:00:00Z',
    ' 2026-01-01', '2026-01-01\n', '', null, undefined, 20260101,
  ])('rejects malformed or impossible dates: %s', (value) => {
    const result = validate('other', { custom_date: value }, {});
    expect(result.standards_issues).toEqual(['custom_date: not ISO 8601']);
    expect(result.needs_review).toBe(true);
  });

  it.each([
    'SGD', 'MYR', 'USD', 'EUR', 'GBP', 'CNY', 'JPY', 'HKD', 'AUD', 'IDR',
    'THB', 'INR', 'CHF', 'CAD', 'NZD', 'KRW', 'VND', 'PHP', 'TWD',
  ])('accepts supported currency %s', (currency) => {
    const result = validate('other', { currency }, {});
    expect(result.standards_issues).toEqual([]);
    expect(result.needs_review).toBe(false);
  });

  it.each(['sgd', 'Sgd', 'SG', 'SGDD', 'XYZ', ' SGD', 'SGD\n', 'constructor', '', null, undefined, 123])(
    'rejects unsupported currency %s', (currency) => {
      const result = validate('other', { currency }, {});
      expect(result.standards_issues).toEqual(['currency: not a supported ISO 4217 code']);
      expect(result.needs_review).toBe(true);
    },
  );

  it('checks all date fields but ignores unrelated keys and absent optional fields', () => {
    const result = validate('other', { invoice_date: 'bad', delivery_date: 'bad', date: 'bad' }, {});
    expect(result.standards_issues).toEqual([
      'invoice_date: not ISO 8601', 'delivery_date: not ISO 8601',
    ]);
    expect(validate('other', {}, {}).needs_review).toBe(false);
  });

  it('propagates standards failures into envelope review status', () => {
    const output = checkModelOutput({
      ...good,
      fields: good.fields.map((field) => ({
        ...field, confidence: 0.99,
        value: field.key === 'invoice_date' ? '2026-02-30' : field.value,
      })),
    });
    const envelope = buildEnvelope('d', output, null);
    expect(envelope.validation.standards_issues).toEqual(['invoice_date: not ISO 8601']);
    expect(envelope.status).toBe('review_required');
  });
});

describe('new document types', () => {
  const examples = [
    { type: 'delivery_order', fields: { customer_name: 'Customer', do_no: 'DO-1', delivery_date: '2026-10-26' } },
    { type: 'receipt', fields: { payer_name: 'Payer', receipt_no: 'R-1', receipt_date: '2026-10-26', currency: 'SGD', amount: 10 } },
  ] as const;

  for (const { type, fields } of examples) {
    it(`accepts a complete ${type}`, () => {
      const output = checkModelOutput({
        document_type: type,
        fields: Object.entries(fields).map(([key, value]) => ({
          key, value, page: 1, bbox: null, confidence: 0.99,
        })),
        line_items: [],
      });
      const envelope = buildEnvelope('d', output, null);
      expect(envelope.document_type).toBe(type);
      expect(envelope.validation.missing_required).toEqual([]);
      expect(envelope.status).toBe('ready');
    });

    for (const key of Object.keys(fields)) {
      it(`requires ${key} for ${type}`, () => {
        const extraction: Record<string, unknown> = { ...fields };
        delete extraction[key];
        const result = validate(type, extraction, {});
        expect(result.missing_required).toEqual([key]);
        expect(result.needs_review).toBe(true);
      });
    }
  }
});
