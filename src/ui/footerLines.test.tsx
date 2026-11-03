import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { Workspace } from './pages/Workspace';
import { clearLocalData } from './storage';
import { saveBatchMode } from '../lib/profiles';
import type { ExtractionProfile } from '../lib/agent/contract';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';

let root: Root;
let container: HTMLDivElement;
const render = async (doc: Batch) => { await act(async () => root.render(<Workspace doc={doc} onSaved={() => {}} />)); };
const footer = () => container.querySelector('section[aria-label="Footer"]') as HTMLElement;
const check = () => footer().querySelector('[role="group"][aria-label="Totals check"]')!.textContent!.replace(/\s+/g, ' ');
const invoice = (header: Record<string, unknown>, rows: string[]) => {
  const doc = buildBatch(invoiceInput());
  doc.transactions[0].data = { supplier_name: 'ABC', invoice_no: 'INV-1', invoice_date: '2026-11-03', currency: 'SGD', ...header, line_items: rows.map(amount => ({ description: 'x', amount })) } as Batch['transactions'][0]['data'];
  return doc;
};
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('the footer check with shipping, discount and tax lines', () => {
  it('lists each line that is counted, with its effect on the total, and says it matches', async () => {
    await render(invoice({ discount: '45.00', shipping_fee: '25.00', tax_amount: '38.70', total_amount: '468.70' }, ['200.00', '150.00', '100.00']));
    const text = check();
    expect(text).toContain('Rows add up to 450.00');
    expect(text).toContain('discount -45.00'); // taken off, although printed as 45.00
    expect(text).toContain('shipping fee 25.00');
    expect(text).toContain('tax 38.70');
    expect(text).toContain('grand total 468.70');
    expect(text).toContain('Matches');
    expect(footer().textContent).not.toContain('The rows and the grand total disagree');
  });

  it('shows the lines of a total that does not add up, and says what to do', async () => {
    await render(invoice({ discount: '45.00', shipping_fee: '25.00', total_amount: '500.00' }, ['450.00']));
    expect(check()).toContain('discount -45.00');
    expect(check()).toContain('Does not match');
    expect(footer().textContent).toContain('Shipping, discount, rounding and similar footer lines are counted for you');
    expect(footer().textContent).toContain('waive the mismatch under Issues');
  });

  it('keeps showing only the rows, tax and total when there are no other lines', async () => {
    await render(invoice({ tax_amount: '53.88', total_amount: '727.38' }, ['673.50']));
    expect(check()).toBe('Rows add up to 673.50 · tax 53.88 · grand total 727.38Matches');
  });

  it('counts a line a template named like a charge, and leaves out text such as a shipping address', async () => {
    const doc = invoice({ rounding: '-0.03', shipping_address: '12 High St', total_amount: '99.97' }, ['100.00']);
    const profile: ExtractionProfile = { id: 'p', name: 'P', rowFields: [{ key: 'description', label: 'Item', type: 'text' }, { key: 'amount', label: 'Amount', type: 'amount' }], fields: [
      { key: 'supplier_name', label: 'Supplier', type: 'text' }, { key: 'rounding', label: 'Rounding', type: 'amount' }, { key: 'shipping_address', label: 'Ship to', type: 'text' }, { key: 'total_amount', label: 'Grand total', type: 'amount' }] };
    saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: 'p' }, profile);
    doc.transactions[0].field_types = { '/rounding': 'amount', '/total_amount': 'amount', '/shipping_address': 'text', '/line_items/0/amount': 'amount' };
    await render(doc);
    expect(check()).toContain('rounding -0.03'); // named by the template's label
    expect(check()).toContain('Matches');
    expect(check()).not.toContain('ship to');
  });
});
