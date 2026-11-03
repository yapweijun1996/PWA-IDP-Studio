import { describe, expect, it } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { BUILTIN_PROFILES } from './agent/contract';
import { labelFromKey, uniqueProfileName, validateProfile } from './profiles';
import { fieldTypeForKey, templateFromTransaction } from './template';
import { readable } from '../ui/nav';

describe('labelFromKey', () => {
  it('writes keys in plain words and keeps business acronyms in capitals', () => {
    expect(labelFromKey('supplier_name')).toBe('Supplier name');
    expect(labelFromKey('po_no')).toBe('PO no');
    expect(labelFromKey('uom')).toBe('UOM');
    expect(labelFromKey('do_no')).toBe('DO no');
    expect(labelFromKey('document_id')).toBe('Document ID');
    expect(labelFromKey('gst_amount')).toBe('GST amount');
  });
  it('does not touch ordinary words that merely contain an acronym', () => {
    expect(labelFromKey('download_url')).toBe('Download url');
    expect(labelFromKey('identity')).toBe('Identity');
    expect(readable('review_required')).toBe('Review required');
  });
});

describe('uniqueProfileName', () => {
  it('numbers a name that is already taken, ignoring case', () => {
    const taken = [{ ...BUILTIN_PROFILES[0], name: 'My template' }, { ...BUILTIN_PROFILES[0], name: 'my template 2' }];
    expect(uniqueProfileName('My template', taken)).toBe('My template 3');
    expect(uniqueProfileName('Shipping', taken)).toBe('Shipping');
    expect(uniqueProfileName('  ', [])).toBe('My template');
  });
});

describe('fieldTypeForKey', () => {
  it('keeps the checks Auto mode applies by key name', () => {
    expect(fieldTypeForKey('invoice_date')).toBe('date');
    expect(fieldTypeForKey('total_amount')).toBe('amount');
    expect(fieldTypeForKey('unit_price')).toBe('amount');
    expect(fieldTypeForKey('quantity')).toBe('quantity');
    expect(fieldTypeForKey('invoice_no')).toBe('code');
    expect(fieldTypeForKey('stock_code')).toBe('code');
    expect(fieldTypeForKey('currency')).toBe('code');
    expect(fieldTypeForKey('uom')).toBe('code');
    expect(fieldTypeForKey('supplier_name')).toBe('text');
    expect(fieldTypeForKey('description')).toBe('text');
  });
});

describe('templateFromTransaction', () => {
  const invoice = () => { const batch = buildBatch(invoiceInput()); return { batch, tx: batch.transactions[0], type: batch.documents[0].document_type }; };
  it('starts an Auto result from what the document contains, typed and with its required fields marked', () => {
    const { tx, type } = invoice();
    const template = templateFromTransaction(tx, type, 'Mine');
    expect(template.name).toBe('Mine');
    expect(template.builtin).toBeUndefined();
    const byKey = Object.fromEntries(template.fields.map(f => [f.key, f]));
    expect(Object.keys(byKey).sort()).toEqual(['currency', 'invoice_date', 'invoice_no', 'supplier_name', 'total_amount']);
    expect(byKey.supplier_name).toEqual({ key: 'supplier_name', label: 'Supplier name', type: 'text', required: true });
    expect(byKey.invoice_date.type).toBe('date');
    expect(byKey.total_amount.type).toBe('amount');
    expect(template.rowFields.map(f => [f.key, f.type]).sort()).toEqual([['amount', 'amount'], ['description', 'text'], ['quantity', 'quantity'], ['unit_price', 'amount']]);
    expect(validateProfile(template)).toEqual([]);
  });
  it('keeps a required field that came back empty, but leaves out optional fields with no value', () => {
    const { tx, type } = invoice();
    tx.data.currency = null; tx.data.po_no = null; tx.data.remarks = '';
    const keys = templateFromTransaction(tx, type, 'Mine').fields.map(f => f.key);
    expect(keys).toContain('currency');
    expect(keys).not.toContain('po_no');
    expect(keys).not.toContain('remarks');
  });
  it('leaves out row columns that are empty on every row', () => {
    const { tx, type } = invoice();
    tx.data.line_items = [{ description: 'A', uom: null, amount: '5.00' }, { description: 'B', uom: '', amount: '6.00' }];
    expect(templateFromTransaction(tx, type, 'Mine').rowFields.map(f => f.key)).toEqual(['description', 'amount']);
  });
  it('keeps the field types a result declares instead of guessing them from the key name', () => {
    const { tx, type } = invoice();
    tx.field_types = { '/currency': 'text', '/supplier_name': 'code', '/line_items/0/description': 'code', '/line_items/0/amount': 'text' };
    const template = templateFromTransaction(tx, type, 'Mine');
    const header = Object.fromEntries(template.fields.map(f => [f.key, f.type]));
    expect(header.currency).toBe('text'); // declared, although a key name alone would say code
    expect(header.supplier_name).toBe('code'); // declared, although a key name alone would say text
    expect(header.total_amount).toBe('amount'); // not declared: falls back to the key name
    const rows = Object.fromEntries(template.rowFields.map(f => [f.key, f.type]));
    expect(rows.description).toBe('code'); expect(rows.amount).toBe('text'); expect(rows.quantity).toBe('quantity');
  });
  it('starts a templated result from a copy of that template and never touches the saved one', () => {
    const { tx, type } = invoice();
    const base = { ...BUILTIN_PROFILES[1], builtin: false, id: 'shipping', name: 'Shipping' };
    const copy = templateFromTransaction(tx, type, 'Shipping (edited)', base);
    expect(copy.id).not.toBe('shipping');
    expect(copy.name).toBe('Shipping (edited)');
    expect(copy.builtin).toBe(false);
    expect(copy.fields).toEqual(base.fields);
    copy.fields.push({ key: 'batch_no', label: 'Batch No', type: 'text' });
    expect(base.fields.some(f => f.key === 'batch_no')).toBe(false);
  });
});
