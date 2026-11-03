import { describe, expect, it } from 'vitest';
import { adjustmentOf, isFooterKey } from '../lib/footerLines';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { businessIssues, reconcileTotals } from './rules';
import type { Batch, Transaction } from './types';

describe('which keys are footer lines, and what they do to the total', () => {
  it.each([
    ['shipping_fee', 'add'], ['shipping_amount', 'add'], ['freight_charge', 'add'], ['handling_charge', 'add'], ['surcharge', 'add'], ['insurance_fee', 'add'],
    ['rounding', 'add'], ['rounding_adjustment', 'add'], ['gst_amount', 'add'], ['vat_amount', 'add'], ['tax_amount', 'add'], ['tax', 'add'],
    ['discount', 'subtract'], ['discount_amount', 'subtract'], ['rebate', 'subtract'], ['trade_discount', 'subtract'],
  ])('%s %s', (key, effect) => expect(adjustmentOf(key)).toBe(effect));

  it.each(['total_amount', 'subtotal_amount', 'grand_total', 'amount_due', 'balance_due', 'total_quantity'])('%s is a footer total, not a line added to it', key => {
    expect(isFooterKey(key)).toBe(true);
    expect(adjustmentOf(key)).toBeUndefined();
  });

  it.each(['shipping_address', 'shipping_method', 'discount_code', 'discount_terms', 'tax_id', 'gst_no', 'vat_no', 'due_date', 'supplier_name', 'po_no', 'currency', 'remarks'])(
    '%s only mentions a charge, so it is not a line', key => expect(adjustmentOf(key)).toBeUndefined());

  it('treats a key that is both a total and a charge as the charge', () => {
    expect(adjustmentOf('total_shipping')).toBe('add');
    expect(adjustmentOf('total_discount')).toBe('subtract');
  });
});

const make = () => { const batch = buildBatch(invoiceInput()); return { batch, tx: batch.transactions[0] }; };
const setup = (tx: Transaction, rows: string[], header: Record<string, unknown>) => {
  tx.data = { supplier_name: 'ABC', ...header, line_items: rows.map(amount => ({ description: 'x', amount })) } as Transaction['data'];
};
const mismatch = (batch: Batch) => businessIssues(batch).some(i => i.rule_code === 'TOTALS_MISMATCH');

describe('a total that includes footer lines', () => {
  it('reconciles rows, discount, shipping and tax: 450.00 - 45.00 + 25.00 + 38.70 = 468.70', () => {
    const { tx } = make();
    setup(tx, ['200.00', '150.00', '100.00'], { discount: '45.00', shipping_fee: '25.00', tax_amount: '38.70', total_amount: '468.70' });
    const check = reconcileTotals(tx)!;
    expect(check.ok).toBe(true);
    expect(check.net).toBe('450');
    expect(check.lines).toEqual([{ key: 'discount', amount: '-45.00' }, { key: 'shipping_fee', amount: '25.00' }]); // a discount's effect is negative
    expect(check.tax).toBe('38.70');
  });
  it('takes a discount off whichever sign it is printed with', () => {
    for (const printed of ['45.00', '-45.00']) {
      const { tx } = make();
      setup(tx, ['450.00'], { discount_amount: printed, total_amount: '405.00' });
      expect(reconcileTotals(tx)?.ok, printed).toBe(true);
      expect(reconcileTotals(tx)?.lines[0].amount).toBe('-45.00');
    }
  });
  it('adds a rounding as printed, so a negative one lowers the total (Swiss rounding to 0.05)', () => {
    for (const [rounding, total] of [['-0.03', '99.97'], ['0.03', '100.03'], ['-0.02', '99.98']]) {
      const { tx } = make();
      setup(tx, ['100.00'], { rounding, total_amount: total });
      expect(reconcileTotals(tx)?.ok, `${rounding} -> ${total}`).toBe(true);
    }
  });
  it('accepts the rows alone or rows plus tax as before, whatever lines are printed', () => {
    const { tx } = make();
    setup(tx, ['100.00'], { shipping_fee: '10.00', total_amount: '100.00' }); expect(reconcileTotals(tx)?.ok).toBe(true);
    setup(tx, ['100.00'], { shipping_fee: '10.00', tax_amount: '9.00', total_amount: '109.00' }); expect(reconcileTotals(tx)?.ok).toBe(true);
  });
  it('does not accept a total that includes only some of the lines', () => {
    const { tx } = make();
    setup(tx, ['100.00'], { shipping_fee: '10.00', discount: '5.00', total_amount: '110.00' }); // shipping but not the discount
    expect(reconcileTotals(tx)?.ok).toBe(false);
    setup(tx, ['100.00'], { shipping_fee: '10.00', discount: '5.00', total_amount: '95.00' }); // the discount but not the shipping
    expect(reconcileTotals(tx)?.ok).toBe(false);
    setup(tx, ['100.00'], { shipping_fee: '10.00', discount: '5.00', total_amount: '105.00' }); // all of them
    expect(reconcileTotals(tx)?.ok).toBe(true);
  });
  it('still flags a total that is simply wrong', () => {
    const { tx } = make();
    setup(tx, ['100.00'], { shipping_fee: '10.00', discount: '5.00', total_amount: '108.00' });
    expect(reconcileTotals(tx)?.ok).toBe(false);
  });
  it('ignores lines that are not numbers and keys that only mention a charge', () => {
    const { tx } = make();
    setup(tx, ['100.00'], { shipping_fee: 'free', shipping_address: '12 High St', discount_code: 'SPRING', discount: null, total_amount: '100.00' });
    expect(reconcileTotals(tx)?.lines).toEqual([]);
    setup(tx, ['100.00'], { shipping_fee: 'free', shipping_address: '12 High St', total_amount: '110.00' });
    expect(reconcileTotals(tx)?.ok).toBe(false); // nothing numeric to add, so 110 does not reconcile
  });
  it('applies in a result read with a template when it declares total_amount as an amount', () => {
    const { tx } = make();
    setup(tx, ['100.00'], { shipping_fee: '10.00', total_amount: '110.00' });
    tx.field_types = { '/total_amount': 'amount', '/shipping_fee': 'amount' };
    expect(reconcileTotals(tx)?.ok).toBe(true);
    tx.field_types = { '/total_amount': 'text', '/shipping_fee': 'amount' };
    expect(reconcileTotals(tx)).toBeNull();
  });
  it('is exactly what the TOTALS_MISMATCH rule decides', () => {
    const cases: [string[], Record<string, unknown>][] = [
      [['200.00', '150.00', '100.00'], { discount: '45.00', shipping_fee: '25.00', tax_amount: '38.70', total_amount: '468.70' }],
      [['100.00'], { shipping_fee: '10.00', discount: '5.00', total_amount: '110.00' }], [['100.00'], { rounding: '-0.03', total_amount: '99.97' }],
      [['100.00'], { shipping_fee: '10.00', total_amount: '110.00' }], [['100.00'], { total_amount: '99.00' }], [['100.00'], { handling: 'n/a', total_amount: '100.00' }],
    ];
    for (const [rows, header] of cases) {
      const { batch, tx } = make();
      setup(tx, rows, header);
      const check = reconcileTotals(tx);
      expect(mismatch(batch), JSON.stringify(header)).toBe(check !== null && !check.ok);
    }
  });
});
