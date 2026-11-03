import { beforeEach, describe, expect, it } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { groupedJSONValue, transactionJSONValue } from './jsonExport';
import { clearProfiles, saveBatchMode } from './profiles';
import type { ExtractionProfile } from './agent/contract';

beforeEach(() => { clearProfiles(); localStorage.clear(); });
const make = () => { const batch = buildBatch(invoiceInput()); return { batch, id: batch.transactions[0].transaction_id }; };

describe('groupedJSONValue', () => {
  it('groups an Auto result into document, rows and footer, with the same values as the clean JSON', () => {
    const { batch, id } = make();
    const flat = transactionJSONValue(batch, id) as Record<string, unknown>;
    const grouped = groupedJSONValue(batch, id) as Record<string, unknown>;
    expect(Object.keys(grouped)).toEqual(['document_type', 'document', 'rows', 'footer']);
    expect(Object.keys(grouped.document as object).sort()).toEqual(['currency', 'invoice_date', 'invoice_no', 'supplier_name']);
    expect(Object.keys(grouped.footer as object)).toEqual(['total_amount']);
    expect(grouped.rows).toEqual(flat.line_items);
    // Nothing is lost or invented: every flat value appears exactly once in the grouped shape.
    const { document_type, line_items, ...header } = flat;
    expect({ ...(grouped.document as object), ...(grouped.footer as object) }).toEqual(header);
    expect(grouped.document_type).toBe(document_type);
    expect(line_items).toBeDefined();
  });

  it('follows the template: an explicit footer choice moves a field, and a template result has no document_type', () => {
    const { batch, id } = make();
    batch.transactions[0].data = { po_no: 'PO-1', handling: '5.00', discount_code: 'SPRING', total_amount: '105.00', line_items: [{ description: 'x', amount: '100.00' }] };
    const profile: ExtractionProfile = { id: 'p', name: 'P', rowFields: [{ key: 'description', label: 'Item', type: 'text' }], fields: [
      { key: 'po_no', label: 'PO no', type: 'code' }, { key: 'handling', label: 'Handling', type: 'amount', section: 'footer' },
      { key: 'discount_code', label: 'Discount code', type: 'code' }, { key: 'total_amount', label: 'Total', type: 'amount', section: 'info' } ] };
    saveBatchMode(batch.batch.batch_id, { kind: 'targeted', profileId: 'p' }, profile);
    const grouped = groupedJSONValue(batch, id);
    expect(grouped).toEqual({ document: { po_no: 'PO-1', discount_code: 'SPRING', total_amount: '105.00' }, rows: [{ description: 'x', amount: '100.00' }], footer: { handling: '5.00' } });
  });

  it('always has the three groups, empty when there is nothing for them', () => {
    const { batch, id } = make();
    batch.transactions[0].data = { invoice_no: 'A' };
    expect(groupedJSONValue(batch, id)).toMatchObject({ document: { invoice_no: 'A' }, rows: [], footer: {} });
  });

  it('refuses an unknown transaction', () => {
    expect(() => groupedJSONValue(make().batch, 'nope')).toThrow('Unknown transaction');
  });
});
