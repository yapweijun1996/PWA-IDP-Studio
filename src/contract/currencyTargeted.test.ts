import { describe, expect, it } from 'vitest';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { approveTransaction, correctField, recomputeIssues } from './review';
import { businessIssues } from './rules';
import type { Batch, Transaction } from './types';

const make = () => { const batch = buildBatch(invoiceInput()); return { batch, tx: batch.transactions[0], id: batch.transactions[0].transaction_id }; };
const iso = (batch: Batch) => businessIssues(batch).filter(i => i.rule_code === 'STANDARDS_ISO4217');
const missing = (batch: Batch) => businessIssues(batch).filter(i => i.rule_code === 'MISSING_REQUIRED').map(i => i.message);
/** The same invoice read with a template: types are declared, so the rules follow the template. */
const targeted = (tx: Transaction, currency: unknown, extra: Partial<Transaction> = {}) => {
  tx.data = { supplier_name: 'ABC', currency: currency as never, total_amount: '10.00', line_items: [{ description: 'x', amount: '10.00' }] };
  tx.field_evidence = {}; tx.field_types = { '/supplier_name': 'text', '/currency': 'code', '/total_amount': 'amount', '/line_items/0/description': 'text', '/line_items/0/amount': 'amount' };
  tx.required_fields = ['/supplier_name']; Object.assign(tx, extra);
};

describe('the currency rule in a result read with a template', () => {
  it('rejects a currency that is not an ISO 4217 code, as Auto mode does', () => {
    for (const value of ['S$', 'sgd', 'Singapore dollars', 'US', 'XYZ']) {
      const { batch, tx } = make(); targeted(tx, value);
      expect(iso(batch).map(i => i.message), String(value)).toEqual(['/currency: not ISO 4217.']);
    }
  });
  it('accepts a real code', () => {
    for (const value of ['SGD', 'USD', 'MYR', 'EUR', 'JPY']) { const { batch, tx } = make(); targeted(tx, value); expect(iso(batch), value).toEqual([]); }
  });
  it('does not call an optional currency the document did not print an error', () => {
    for (const value of [null, '']) { const { batch, tx } = make(); targeted(tx, value); expect(iso(batch), String(value)).toEqual([]); }
  });
  it('still reports a required currency that is missing, as missing and not as a bad code', () => {
    const { batch, tx } = make(); targeted(tx, null, { required_fields: ['/supplier_name', '/currency'] });
    expect(iso(batch)).toEqual([]); expect(missing(batch)).toEqual(['/currency: required field is missing.']);
  });
  it('also checks a currency column in the rows', () => {
    const { batch, tx } = make(); targeted(tx, 'SGD');
    tx.data.line_items = [{ description: 'x', amount: '10.00', currency: 'SGD' }, { description: 'y', amount: '0.00', currency: 'S$' }];
    tx.field_types!['/line_items/1/currency'] = 'code';
    expect(iso(batch).map(i => i.message)).toEqual(['/line_items/1/currency: not ISO 4217.']);
  });
  it('only looks at a field keyed currency', () => {
    const { batch, tx } = make(); targeted(tx, 'SGD');
    tx.data.invoice_currency = 'dollars'; tx.field_types!['/invoice_currency'] = 'text';
    expect(iso(batch)).toEqual([]);
  });
  it('blocks approval until the code is corrected, then lets it through', () => {
    const { batch, tx, id } = make(); targeted(tx, 'S$'); batch.evidence = []; batch.issues = []; // the fixture's evidence and issues point at fields this data no longer has
    const flagged = recomputeIssues(batch);
    expect(flagged.issues.some(i => i.rule_code === 'STANDARDS_ISO4217' && i.status === 'open' && i.severity === 'blocking')).toBe(true);
    expect(approveTransaction(flagged, id, 'ok').ok).toBe(false);
    const fixed = correctField(flagged, id, '/currency', 'SGD', 'Printed as S$');
    expect(fixed.issues.some(i => i.rule_code === 'STANDARDS_ISO4217' && i.status === 'open')).toBe(false);
    expect(approveTransaction(fixed, id, 'ok').ok).toBe(true);
  });
});

describe('the currency rule in an Auto result is unchanged', () => {
  it('still rejects a bad code and an empty one', () => {
    for (const value of ['S$', null, '']) { const { batch, tx } = make(); tx.data.currency = value; expect(iso(batch).length, String(value)).toBe(1); }
  });
  it('accepts a real code', () => { const { batch } = make(); expect(iso(batch)).toEqual([]); });
});
