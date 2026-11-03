import { describe, expect, it } from 'vitest';
import { defaultSection, sectionOf } from './sections';
import { BUILTIN_PROFILES, type ExtractionProfile } from './agent/contract';
import { AUTO_HEADER_KEYS } from './standards';

describe('defaultSection', () => {
  it.each([
    'total_amount', 'subtotal_amount', 'tax_amount', 'grand_total', 'discount_amount', 'shipping_fee', 'shipping_amount', 'freight_charge',
    'rounding', 'rounding_adjustment', 'gst_amount', 'vat_amount', 'amount_due', 'balance_due', 'tax', 'total_quantity', 'gst_rate',
  ])('%s is a footer line', key => expect(defaultSection(key)).toBe('footer'));

  it.each([
    'supplier_name', 'customer_name', 'invoice_no', 'po_no', 'invoice_date', 'delivery_date', 'currency', 'document_no', 'transaction_date',
    'remarks', 'payer_name', 'amount', 'period',
  ])('%s is document info', key => expect(defaultSection(key)).toBe('info'));

  it.each(['tax_id', 'tax_code', 'gst_no', 'vat_no', 'shipping_address', 'shipping_method', 'discount_code', 'discount_terms', 'due_date', 'total_ref', 'total_date'])(
    '%s only mentions a footer word, so it stays document info', key => expect(defaultSection(key)).toBe('info'));

  it('treats a declared date as document info whatever its name', () => {
    expect(defaultSection('total_period', 'date')).toBe('info');
  });

  it('puts exactly the three totals of Auto mode in the footer', () => {
    expect(AUTO_HEADER_KEYS.filter(key => defaultSection(key) === 'footer').sort()).toEqual(['subtotal_amount', 'tax_amount', 'total_amount']);
  });

  it('puts exactly the totals of the built-in templates in the footer', () => {
    const footers = BUILTIN_PROFILES.map(p => p.fields.filter(f => defaultSection(f.key, f.type) === 'footer').map(f => f.key));
    expect(footers).toEqual([[], [], ['subtotal_amount', 'tax_amount', 'total_amount']]);
  });
});

describe('sectionOf', () => {
  const profile: ExtractionProfile = { id: 'p', name: 'P', rowFields: [], fields: [
    { key: 'admin_fee', label: 'Admin fee', type: 'amount', section: 'footer' },
    { key: 'discount_code', label: 'Discount code', type: 'code', section: 'info' },
    { key: 'total_amount', label: 'Total', type: 'amount', section: 'info' },
    { key: 'shipping_fee', label: 'Shipping', type: 'amount' },
    { key: 'supplier_name', label: 'Supplier', type: 'text' },
  ] };
  it('uses the template\'s explicit choice, even against the default', () => {
    expect(sectionOf('admin_fee', profile)).toBe('footer'); // no default would say so
    expect(sectionOf('total_amount', profile)).toBe('info'); // the user moved it up
  });
  it('falls back to the default for a field with no choice, and for a key the template does not have', () => {
    expect(sectionOf('shipping_fee', profile)).toBe('footer');
    expect(sectionOf('supplier_name', profile)).toBe('info');
    expect(sectionOf('tax_amount', profile)).toBe('footer');
  });
  it('uses the default for every field when there is no template', () => {
    expect(sectionOf('total_amount')).toBe('footer');
    expect(sectionOf('invoice_no')).toBe('info');
  });
});
