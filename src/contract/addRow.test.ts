import { describe, expect, it } from 'vitest';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { addRow, approveTransaction, handEnteredRows, type RowColumn } from './review';
import { validateBatch } from './validate';
import type { Batch } from './types';

const columns: RowColumn[] = [{ key: 'description' }, { key: 'quantity' }, { key: 'unit_price' }, { key: 'amount' }];
const make = () => { const batch = buildBatch(invoiceInput()); return { batch, id: batch.transactions[0].transaction_id }; };
const rowsOf = (batch: Batch) => batch.transactions[0].data.line_items as Record<string, unknown>[];
const open = (batch: Batch, code: string) => batch.issues.filter(i => i.status === 'open' && i.rule_code === code);
/** The same invoice read with a template: types are declared per cell and the description is required. */
const targeted = () => {
  const { batch, id } = make();
  const tx = batch.transactions[0];
  tx.field_types = { '/total_amount': 'amount', '/line_items/0/description': 'text', '/line_items/0/quantity': 'quantity', '/line_items/0/unit_price': 'amount', '/line_items/0/amount': 'amount' };
  tx.required_fields = ['/supplier_name', '/line_items/0/description'];
  return { batch, id };
};

describe('addRow', () => {
  it('appends a row at the end with the same columns, blank cells null and decimals normalized', () => {
    const { batch, id } = make();
    const before = rowsOf(batch).length;
    const next = addRow(batch, id, columns, { description: ' Extra item ', quantity: '2', unit_price: '', amount: '1,250.50' }, 'Missing from the scan');
    const rows = rowsOf(next);
    expect(rows).toHaveLength(before + 1);
    expect(Object.keys(rows[before]).sort()).toEqual(['amount', 'description', 'quantity', 'unit_price']);
    expect(rows[before].description).toBe('Extra item');
    expect(rows[before].unit_price).toBeNull();
    expect(String(rows[before].amount)).not.toContain(','); // normalized like a corrected cell
    expect(Number(rows[before].amount)).toBe(1250.5);
  });

  it('leaves the earlier rows, their evidence and the input batch untouched', () => {
    const { batch, id } = make();
    const snapshot = structuredClone(batch);
    const next = addRow(batch, id, columns, { description: 'Extra item', amount: '1' }, 'Missing');
    expect(batch).toEqual(snapshot); // the input is never mutated
    expect(rowsOf(next)[0]).toEqual(rowsOf(batch)[0]);
    expect(next.evidence).toEqual(batch.evidence);
    expect(next.transactions[0].field_evidence).toEqual(batch.transactions[0].field_evidence);
    expect(validateBatch(next).ok).toBe(true);
  });

  it('records who added it and why in the review trail, and marks the row as entered by hand', () => {
    const { batch, id } = make();
    const first = addRow(batch, id, columns, { description: 'First extra', amount: '1' }, 'Missing from the scan');
    const added = first.reviews.at(-1)!;
    expect(added).toMatchObject({ target_type: 'transaction', target_id: id, action: 'correct', actor_id: 'local_user' });
    expect(added.reason).toBe(`Row added by hand: row ${rowsOf(batch).length + 1}. Missing from the scan`);
    expect(added.new_revision).toBe(added.prior_revision + 1);
    expect(first.batch.revision).toBe(batch.batch.revision + 1);
    expect(handEnteredRows(batch, id)).toEqual(new Set());
    const second = addRow(first, id, columns, { description: 'Second extra', amount: '2' }, 'Also missing');
    expect(handEnteredRows(second, id)).toEqual(new Set([rowsOf(batch).length, rowsOf(batch).length + 1]));
    // Another transaction's rows are not reported.
    expect(handEnteredRows(second, 'another_transaction')).toEqual(new Set());
  });

  it('withdraws an approval, because the rows it approved have changed', () => {
    const { batch, id } = make();
    const approved = approveTransaction(batch, id, 'ok');
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.batch.transactions[0].status).toBe('approved');
    const next = addRow(approved.batch, id, columns, { description: 'Late item', amount: '0' }, 'Forgotten line');
    expect(next.transactions[0].status).not.toBe('approved');
  });

  it('runs the totals rule again: a row that breaks the total blocks approval, a row that keeps it does not', () => {
    const { batch, id } = make();
    const wrong = addRow(batch, id, columns, { description: 'Extra', amount: '10' }, 'Missing');
    expect(open(wrong, 'TOTALS_MISMATCH')).toHaveLength(1);
    expect(wrong.transactions[0].status).toBe('review_required');
    expect(approveTransaction(wrong, id, 'ok').ok).toBe(false);
    const fine = addRow(batch, id, columns, { description: 'Free sample', amount: '0.00' }, 'Missing');
    expect(open(fine, 'TOTALS_MISMATCH')).toHaveLength(0);
  });

  it('refuses text in a number column, because an invalid decimal would not block approval', () => {
    const { batch, id } = make();
    expect(() => addRow(batch, id, columns, { description: 'Extra', amount: 'abc' }, 'Missing')).toThrow('amount: enter a number');
    expect(() => addRow(batch, id, [{ key: 'amount', label: 'Amount' }], { amount: '12,5x' }, 'Missing')).toThrow('Amount: enter a number');
    expect(rowsOf(batch)).toHaveLength(1);
    expect(() => addRow(batch, id, columns, { description: 'Free text is fine here', quantity: '', amount: '1,250.50' }, 'Missing')).not.toThrow();
  });

  it('refuses what cannot be a row', () => {
    const { batch, id } = make();
    expect(() => addRow(batch, id, columns, { description: 'x' }, '  ')).toThrow('Enter a reason');
    expect(() => addRow(batch, id, columns, { description: '  ', amount: '' }, 'Missing')).toThrow('Enter at least one value');
    expect(() => addRow(batch, 'nope', columns, { description: 'x' }, 'Missing')).toThrow('Unknown transaction');
    expect(() => addRow(batch, id, [], { description: 'x' }, 'Missing')).toThrow('Invalid row columns');
    expect(() => addRow(batch, id, [{ key: 'a' }, { key: 'a' }], { a: 'x' }, 'Missing')).toThrow('Invalid row columns');
    expect(() => addRow(batch, id, [{ key: '__proto__' }], { __proto__: 'x' }, 'Missing')).toThrow('Invalid row columns');
    const noRows = structuredClone(batch); delete noRows.transactions[0].data.line_items;
    expect(() => addRow(noRows, id, columns, { description: 'x' }, 'Missing')).toThrow('no rows to add to');
    expect(rowsOf(batch)).toHaveLength(1); // nothing was added by any of the refused calls
  });

  describe('in a result read with a template', () => {
    it('gives the new row the declared types of its columns, so it is validated like the others', () => {
      const { batch, id } = targeted();
      const next = addRow(batch, id, columns, { description: 'Extra', quantity: '3', amount: '4' }, 'Missing');
      const types = next.transactions[0].field_types!;
      expect(types['/line_items/1/description']).toBe('text');
      expect(types['/line_items/1/quantity']).toBe('quantity');
      expect(types['/line_items/1/amount']).toBe('amount');
    });
    it('refuses text in a column the template declares as a number, whatever its name', () => {
      const { batch, id } = targeted();
      expect(() => addRow(batch, id, columns, { description: 'Extra', amount: 'abc' }, 'Missing')).toThrow('amount: enter a number');
      expect(() => addRow(batch, id, [...columns, { key: 'weight', type: 'quantity' }], { weight: 'heavy' }, 'Missing')).toThrow('weight: enter a number');
      expect(() => addRow(batch, id, [...columns, { key: 'weight', type: 'text' }], { weight: 'heavy' }, 'Missing')).not.toThrow();
    });
    it('carries the required mark over, so a required cell cannot be left blank', () => {
      const { batch, id } = targeted();
      const next = addRow(batch, id, columns, { quantity: '3' }, 'Missing');
      expect(next.transactions[0].required_fields).toContain('/line_items/1/description');
      expect(open(next, 'MISSING_REQUIRED').some(i => i.message.startsWith('/line_items/1/description:'))).toBe(true);
      expect(next.transactions[0].status).toBe('review_required');
    });
    it('takes the type and required mark of a column no row has yet from the column itself', () => {
      const { batch, id } = targeted();
      const next = addRow(batch, id, [...columns, { key: 'colour', type: 'code', required: true }], { description: 'Extra' }, 'Missing');
      expect(next.transactions[0].field_types!['/line_items/1/colour']).toBe('code');
      expect(next.transactions[0].required_fields).toContain('/line_items/1/colour');
    });
    it('falls back to text for a column with no declared type anywhere', () => {
      const { batch, id } = targeted();
      const next = addRow(batch, id, [...columns, { key: 'note' }], { note: 'hello' }, 'Missing');
      expect(next.transactions[0].field_types!['/line_items/1/note']).toBe('text');
    });
    it('does not add field types to an Auto result, which validates by key name', () => {
      const { batch, id } = make();
      expect(addRow(batch, id, columns, { description: 'x', amount: '1' }, 'Missing').transactions[0].field_types).toBeUndefined();
    });
  });
});
