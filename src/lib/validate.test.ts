import { describe, expect, it } from 'vitest';
import { normalizeWireBox } from './bbox';
import { checkModelOutput, parseModelJson } from './validate';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { REQUIRED_FIELDS } from './standards';

const standardsIssues = (data: Record<string, unknown>) => {
  const input = invoiceInput();
  input.output = checkModelOutput({ document_type: 'unknown', fields: Object.entries(data).map(([key, value]) => ({ key, value, page: 1, bbox: null, confidence: 1 })), line_items: [] });
  return buildBatch(input).issues.filter(i => i.rule_code.startsWith('STANDARDS_'));
};
describe('normalizeWireBox', () => {
  it('converts wire y/x coordinates to normalized envelope x/y coordinates', () => {
    expect(normalizeWireBox([100, 200, 300, 600])).toEqual([0.2, 0.1, 0.6, 0.3]);
  });
  it('rejects malformed and degenerate boxes', () => {
    for (const box of [null, [1, 2, 3], [500, 500, 500, 900], ['a', 1, 2, 3]]) expect(normalizeWireBox(box)).toBeNull();
  });
  it('clamps out-of-range values', () => { expect(normalizeWireBox([-50, 0, 2000, 1000])).toEqual([0, 0, 1, 1]); });
});
describe('parsing', () => {
  it('extracts JSON from fenced prose', () => { expect(parseModelJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 }); });
  it('rejects bad output', () => {
    expect(() => parseModelJson('no json')).toThrow();
    expect(() => checkModelOutput({ document_type: 'nope', fields: [] })).toThrow(/document_type/);
    expect(() => checkModelOutput({ document_type: 'unknown', fields: [], line_items: [null] })).toThrow(/line_items/);
  });
});
describe('standards validation through batch construction', () => {
  it.each(['2024-02-29', '2000-02-29', '2026-04-30', '0001-01-01', '9999-12-31'])('accepts real ISO date %s', value => {
    expect(standardsIssues({ custom_date: value })).toEqual([]);
  });
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '0000-01-01', '2026-1-01', '26-01-01', '2026-01-01T00:00:00Z', ' 2026-01-01', '2026-01-01\n', '', null, undefined, 20260101])('rejects impossible or malformed date %s', value => {
    expect(standardsIssues({ custom_date: value })).toMatchObject([{ rule_code: 'STANDARDS_ISO8601', severity: 'blocking', status: 'open' }]);
  });
  it.each(['SGD', 'MYR', 'USD', 'EUR', 'GBP', 'CNY', 'JPY', 'HKD', 'AUD', 'IDR', 'THB', 'INR', 'CHF', 'CAD', 'NZD', 'KRW', 'VND', 'PHP', 'TWD'])('accepts ISO currency %s', currency => {
    expect(standardsIssues({ currency })).toEqual([]);
  });
  it.each(['sgd', 'Sgd', 'SG', 'SGDD', 'XYZ', ' SGD', 'SGD\n', 'constructor', '', null, undefined, 123])('rejects unsupported currency %s', currency => {
    expect(standardsIssues({ currency })).toMatchObject([{ rule_code: 'STANDARDS_ISO4217', severity: 'blocking' }]);
  });
  it('checks all date fields, ignores unrelated keys and absent optional fields', () => {
    expect(standardsIssues({ invoice_date: 'bad', delivery_date: 'bad', date: 'bad' }).map(i => i.message)).toEqual(['/invoice_date: not ISO 8601.', '/delivery_date: not ISO 8601.']);
    expect(standardsIssues({})).toEqual([]);
  });
});
describe('business type requirements', () => {
  const examples = [
    { type: 'delivery_order', fields: { customer_name: 'Customer', do_no: 'DO-1', delivery_date: '2026-10-26' } },
    { type: 'bank_receipt', fields: { payer_name: 'Payer', receipt_no: 'R-1', receipt_date: '2026-10-26', currency: 'SGD', amount: 10 } },
    { type: 'sales_invoice', fields: { customer_name: 'Customer', invoice_no: 'INV-1', invoice_date: '2026-10-26', currency: 'SGD', total_amount: '10' } },
  ] as const;
  for (const { type, fields } of examples) {
    it(`accepts a complete ${type} and requires every mandatory field`, () => {
      for (const missing of [null, ...REQUIRED_FIELDS[type]]) {
        const input = invoiceInput();
        input.output = checkModelOutput({ document_type: type, fields: Object.entries(fields).filter(([key]) => key !== missing).map(([key, value]) => ({ key, value, page: 1, bbox: null, confidence: 0.99 })), line_items: [] });
        const batch = buildBatch(input);
        expect(batch.documents[0].document_type).toBe(type);
        expect(batch.issues.filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.message)).toEqual(missing ? [`/${missing}: required field is missing.`] : []);
        expect(batch.transactions[0].status).toBe(missing ? 'review_required' : 'validated');
      }
    });
  }
});
