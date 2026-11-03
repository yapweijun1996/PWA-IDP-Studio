import { describe, expect, it } from 'vitest';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { businessIssues, reconcileTotals } from './rules';
import type { Batch, Transaction } from './types';

const make = () => { const batch = buildBatch(invoiceInput()); return { batch, tx: batch.transactions[0] }; };
const mismatch = (batch: Batch) => businessIssues(batch).some(i => i.rule_code === 'TOTALS_MISMATCH');
const setRows = (tx: Transaction, amounts: (string | null)[]) => { tx.data.line_items = amounts.map(amount => ({ description: 'x', amount })); };

describe('reconcileTotals', () => {
  it('matches when the rows add up to the total', () => {
    const { tx } = make();
    setRows(tx, ['100.00', '250.50']); tx.data.total_amount = '350.50';
    expect(reconcileTotals(tx)).toEqual({ net: '350.5', tax: null, lines: [], total: '350.50', ok: true });
  });
  it('matches when the rows plus a separately printed tax add up to the total', () => {
    const { tx } = make();
    setRows(tx, ['350.00']); tx.data.tax_amount = '31.50'; tx.data.total_amount = '381.50';
    expect(reconcileTotals(tx)).toEqual({ net: '350', tax: '31.50', lines: [], total: '381.50', ok: true });
  });
  it('reports a total that does not match', () => {
    const { tx } = make();
    setRows(tx, ['100.00']); tx.data.total_amount = '99.00';
    expect(reconcileTotals(tx)).toMatchObject({ net: '100', total: '99.00', ok: false });
    tx.data.tax_amount = '5.00'; // 100 + 5 is still not 99
    expect(reconcileTotals(tx)?.ok).toBe(false);
  });
  it('does not apply without a numeric total, without rows, or with a row that has no numeric amount', () => {
    const { tx } = make();
    setRows(tx, ['10.00']); tx.data.total_amount = null; expect(reconcileTotals(tx)).toBeNull();
    tx.data.total_amount = 'abc'; expect(reconcileTotals(tx)).toBeNull();
    tx.data.total_amount = '10.00'; tx.data.line_items = []; expect(reconcileTotals(tx)).toBeNull();
    delete tx.data.line_items; expect(reconcileTotals(tx)).toBeNull();
    setRows(tx, ['10.00', null]); expect(reconcileTotals(tx)).toBeNull();
    setRows(tx, ['10.00', 'n/a']); expect(reconcileTotals(tx)).toBeNull();
  });
  it('applies to a Targeted result only when it declares total_amount as an amount', () => {
    const { tx } = make();
    setRows(tx, ['10.00']); tx.data.total_amount = '10.00';
    tx.field_types = { '/total_amount': 'text' }; expect(reconcileTotals(tx)).toBeNull();
    tx.field_types = {}; expect(reconcileTotals(tx)).toBeNull();
    tx.field_types = { '/total_amount': 'amount' }; expect(reconcileTotals(tx)?.ok).toBe(true);
  });
  it('is exactly what the TOTALS_MISMATCH rule decides, in every case above', () => {
    const cases: [(string | null)[], string | null, string | null][] = [
      [['100.00', '250.50'], '350.50', null], [['350.00'], '381.50', '31.50'], [['100.00'], '99.00', null], [['100.00'], '99.00', '5.00'],
      [['10.00', null], '10.00', null], [['10.00'], null, null], [[], '10.00', null], [['0.10', '0.20'], '0.30', null], [['1,000.00'], '1000', null],
    ];
    for (const [amounts, total, tax] of cases) {
      const { batch, tx } = make();
      setRows(tx, amounts); tx.data.total_amount = total; tx.data.tax_amount = tax;
      const check = reconcileTotals(tx);
      expect(mismatch(batch)).toBe(check !== null && !check.ok);
    }
  });
});
