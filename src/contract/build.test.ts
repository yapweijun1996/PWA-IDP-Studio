import { describe, expect, it } from 'vitest';
import { buildBatch, type BuildInput } from './build';
import { validateBatch, exportEligibleTransactions } from './validate';
import { checkModelOutput } from '../lib/validate';
import { invoiceInput } from './fixtures';

const openCodes = (input: BuildInput) => buildBatch(input).issues.filter(i => i.status === 'open').map(i => i.rule_code);

describe('buildBatch', () => {
  it('builds a schema-valid realistic invoice with decimal data and real geometry only', () => {
    const batch = buildBatch(invoiceInput());
    expect(validateBatch(batch)).toMatchObject({ ok: true, errors: [] });
    expect(batch.transactions[0].data).toMatchObject({ supplier_name: 'ABC Trading Pte Ltd', total_amount: '1280.00', line_items: [{ description: 'Office Supplies', quantity: '10', unit_price: '128', amount: '1280' }] });
    expect(batch.evidence[0]).toMatchObject({ field_pointer: '/supplier_name', method: 'vision_llm', sources: [{ page_number: 1, bbox: { x: 0.12, y: 0.08, width: 0.14, height: 0.03 }, coordinate_system: 'normalized_unrotated_top_left', text_span: null }] });
    expect(batch.transactions[0].field_evidence['/invoice_date']).toBeUndefined();
    expect(batch.issues.filter(i => i.rule_code === 'FIELD_WITHOUT_EVIDENCE').map(i => i.message)).toEqual(['/invoice_date: no bounding box evidence.', '/currency: no bounding box evidence.']);
    expect(batch.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')).toMatchObject({ scope: 'evidence', severity: 'warning' });
    expect(batch.batch.status).toBe('validated');
    expect(batch.transactions[0].status).toBe('validated');
    expect(batch.documents[0].classification_confidence).toBeCloseTo(0.928);
    expect(batch.validation).toMatchObject({ structural_valid: true, reference_valid: true, coverage_valid: true, business_rules_valid: true, validator_version: '1.0.0', export_eligible_transaction_ids: ['t_1'] });
  });
  it('keeps 30 manifest pages when only 20 are rendered and blocks all export', () => {
    const input = invoiceInput();
    input.pages = Array.from({ length: 30 }, (_, n) => ({ page_number: n + 1, width: 595, height: 842 }));
    input.renderedPageCount = 20;
    const b = buildBatch(input);
    expect(b.pages).toHaveLength(30);
    expect(b.pages[19]).toMatchObject({ status: 'classified', regions: [{ region_id: 'r_d_1_20', role: 'full_page' }] });
    expect(b.pages[20]).toMatchObject({ status: 'pending', regions: [], unassigned_reason: 'review_pending' });
    expect(b.documents[0].page_refs).toHaveLength(20);
    const issues = b.issues.filter(i => i.rule_code === 'PAGE_LIMIT_EXCEEDED');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'blocking', scope: 'batch', status: 'open' });
    expect(issues[0].message).toContain('20');
    expect(issues[0].message).toContain('21, 22, 23, 24, 25, 26, 27, 28, 29, 30');
    expect(exportEligibleTransactions(b)).toEqual([]);
    expect(b.transactions[0].status).toBe('review_required');
    expect(validateBatch(b).ok).toBe(true);
    expect(openCodes(invoiceInput())).not.toContain('PAGE_LIMIT_EXCEEDED');
  });
  it.each([
    ['MISSING_REQUIRED', 'supplier_name', '', 'ABC'],
    ['INVALID_DECIMAL', 'total_amount', 'oops', '1280.00'],
    ['TOTALS_MISMATCH', 'total_amount', '100.00', '1280.00'],
    ['STANDARDS_ISO8601', 'invoice_date', '2026-02-29', '2024-02-29'],
    ['STANDARDS_ISO4217', 'currency', 'XYZ', 'SGD'],
  ])('%s opens for invalid data and is absent for valid data', (code, key, bad, good) => {
    const input = invoiceInput();
    input.output.fields.find(f => f.key === key)!.value = bad;
    const b = buildBatch(input);
    expect(b.issues.find(i => i.rule_code === code)).toMatchObject({ severity: code === 'INVALID_DECIMAL' ? 'error' : 'blocking', scope: 'transaction', status: 'open' });
    expect(validateBatch(b).ok).toBe(true);
    input.output.fields.find(f => f.key === key)!.value = good;
    expect(openCodes(input)).not.toContain(code);
  });
  it('uses exact decimals for 0.1 plus 0.2 and rejects invalid line amounts', () => {
    const input = invoiceInput();
    input.output.fields.find(f => f.key === 'total_amount')!.value = '0.3';
    input.output.line_items = [{ amount: '0.1' }, { amount: '0.2' }];
    expect(openCodes(input)).not.toContain('TOTALS_MISMATCH');
    input.output.line_items[0].amount = 'bad';
    expect(openCodes(input)).toContain('INVALID_DECIMAL');
  });
  it('uses threshold 0.85 and never invents evidence for unprocessed pages', () => {
    const input = invoiceInput();
    input.output.fields.forEach(f => { f.confidence = 0.85; f.bbox = [0, 0, 100, 100]; });
    expect(openCodes(input)).not.toContain('LOW_CONFIDENCE');
    expect(openCodes(input)).not.toContain('FIELD_WITHOUT_EVIDENCE');
    input.output.fields[0].page = 2;
    expect(buildBatch(input).transactions[0].field_evidence['/supplier_name']).toBeUndefined();
    expect(openCodes(input)).toContain('FIELD_WITHOUT_EVIDENCE');
  });
  it('handles empty unknown and statement output with no required fields', () => {
    for (const document_type of ['unknown', 'statement'] as const) {
      const input = invoiceInput();
      input.output = { document_type, fields: [], line_items: [] };
      const b = buildBatch(input);
      expect(b.documents[0].classification_confidence).toBe(0.5);
      expect(b.issues).toEqual([]);
      expect(validateBatch(b).ok).toBe(true);
    }
  });
  it('requires sales-invoice customer fields and rejects legacy model types', () => {
    const input = invoiceInput(); input.output.document_type = 'sales_invoice';
    expect(buildBatch(input).issues.filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.message)).toEqual(['/customer_name: required field is missing.']);
    for (const document_type of ['receipt', 'other']) expect(() => checkModelOutput({ document_type, fields: [] })).toThrow(/document_type/);
  });
});
