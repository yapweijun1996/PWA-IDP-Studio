import { describe, expect, it } from 'vitest';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { businessIssues } from './rules';
import type { Batch } from './types';

const make = () => { const batch = buildBatch(invoiceInput()); return { batch, tx: batch.transactions[0] }; };
const about = (batch: Batch, pointer: string) => businessIssues(batch).filter(i => i.message.startsWith(`${pointer}:`)).map(i => i.rule_code).filter(code => code !== 'LOW_CONFIDENCE' && code !== 'FIELD_WITHOUT_EVIDENCE'); // advice, not about the value

describe('an empty amount in an Auto result', () => {
  it('is reported once when it is required: as missing, not also as an invalid decimal', () => {
    for (const value of [null, '']) { const { batch, tx } = make(); tx.data.total_amount = value; expect(about(batch, '/total_amount'), String(value)).toEqual(['MISSING_REQUIRED']); }
  });
  it('is not an error when the amount is optional and the document does not print it', () => {
    for (const value of [null, '']) { const { batch, tx } = make(); tx.data.tax_amount = value; tx.data.subtotal_amount = value; expect(about(batch, '/tax_amount'), String(value)).toEqual([]); expect(about(batch, '/subtotal_amount')).toEqual([]); }
  });
  it('is still an invalid decimal when it has text that is not a number', () => {
    const { batch, tx } = make(); tx.data.total_amount = 'abc'; tx.data.tax_amount = 'n/a';
    expect(about(batch, '/total_amount')).toEqual(['INVALID_DECIMAL']);
    expect(about(batch, '/tax_amount')).toEqual(['INVALID_DECIMAL']);
  });
  it('still reports an empty cell in a row, because the totals check cannot run without every row amount', () => {
    const { batch, tx } = make(); tx.data.line_items = [{ description: 'x', amount: '10.00' }, { description: 'y', amount: null }];
    expect(about(batch, '/line_items/1/amount')).toEqual(['INVALID_DECIMAL']);
  });
});

describe('an empty amount in a result read with a template', () => {
  it('is reported once when required and not at all when optional, as before', () => {
    const { batch, tx } = make();
    tx.field_types = { '/total_amount': 'amount', '/tax_amount': 'amount' }; tx.required_fields = ['/total_amount'];
    tx.data.total_amount = null; tx.data.tax_amount = null;
    expect(about(batch, '/total_amount')).toEqual(['MISSING_REQUIRED']);
    expect(about(batch, '/tax_amount')).toEqual([]);
  });
});
