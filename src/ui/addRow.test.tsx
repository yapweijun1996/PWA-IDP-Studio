import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Workspace } from './pages/Workspace';
import { AddRow, rowColumns } from './AddRow';
import { clearLocalData } from './storage';
import { saveBatchMode } from '../lib/profiles';
import { getBatch } from '../lib/db';
import type { ExtractionProfile } from '../lib/agent/contract';
import { buildBatch } from '../contract/build';
import { approveTransaction } from '../contract/review';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;
const click = async (name: string) => { await act(async () => { button(name)!.click(); }); };
const fill = async (label: string, value: string) => { await act(async () => { const element = [...document.querySelectorAll('input')].find(input => input.id === [...document.querySelectorAll('label')].find(l => l.textContent === label)?.htmlFor)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const saved = async (spy: ReturnType<typeof vi.fn>) => { await act(async () => { await vi.waitFor(() => { if (!spy.mock.calls.length) throw new Error(`not saved yet; dialog says: ${document.querySelector('[role="dialog"]')?.textContent ?? 'closed'}`); }, { timeout: 4000 }); }); };
const render = async (doc: Batch, props: Partial<Parameters<typeof Workspace>[0]> = {}) => { await act(async () => root.render(<Workspace doc={doc} onSaved={() => {}} {...props} />)); };
const headers = () => [...container.querySelectorAll('th')].map(th => th.textContent);
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Add row in the review screen', () => {
  it('offers Add row only for a transaction that has rows, and not while the result is locked', async () => {
    const doc = buildBatch(invoiceInput());
    await render(doc);
    expect(button('Add row')).toBeDefined();
    await render(doc, { locked: true });
    expect(button('Add row')!.disabled).toBe(true);
    const noRows = structuredClone(doc); delete noRows.transactions[0].data.line_items;
    await render(noRows);
    expect(button('Add row')).toBeUndefined();
  });

  it('asks for each column of the rows and a reason, adds the row, stores it and marks it as entered by hand', async () => {
    const doc = buildBatch(invoiceInput());
    const onSaved = vi.fn();
    await render(doc, { onSaved });
    expect(headers()).not.toContain('Source'); // nothing is marked on a document nobody added to
    await click('Add row');
    expect(document.body.textContent).toContain('Add row 2 by hand');
    for (const label of ['Description', 'Quantity', 'Unit price', 'Amount', 'Reason for adding this row']) expect([...document.querySelectorAll('label')].some(l => l.textContent === label)).toBe(true);
    await fill('Description', 'Extra item'); await fill('Amount', '0.00'); await fill('Reason for adding this row', 'Missing from the scan');
    await click('Save row'); await saved(onSaved);
    expect(onSaved).toHaveBeenCalledTimes(1);
    const result = onSaved.mock.calls[0][0] as Batch;
    const rows = result.transactions[0].data.line_items as Record<string, unknown>[];
    expect(rows).toHaveLength(2); expect(rows[1].description).toBe('Extra item');
    expect(result.reviews.at(-1)!.reason).toBe('Row added by hand: row 2. Missing from the scan');
    expect((await getBatch(result.batch.batch_id))?.transactions[0].data.line_items).toHaveLength(2); // persisted, not only in memory
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await render(result);
    expect(headers()).toContain('Source');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    const marks = [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent?.includes('Entered by hand'));
    expect(marks).toEqual([false, true]); // only the added row
  });

  it('keeps the dialog open and says why when the row cannot be added', async () => {
    const doc = buildBatch(invoiceInput());
    const onSaved = vi.fn();
    await render(doc, { onSaved });
    await click('Add row'); await click('Save row'); // every value is blank
    expect(document.body.textContent).toContain('Enter at least one value');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
    await fill('Amount', 'abc'); await click('Save row');
    expect(document.body.textContent).toContain('Amount: enter a number'); // named by its label, not its key
    expect(onSaved).not.toHaveBeenCalled();
    await click('Cancel');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('warns that an approved document loses its approval', async () => {
    const doc = buildBatch(invoiceInput());
    const approved = approveTransaction(doc, doc.transactions[0].transaction_id, 'ok');
    if (!approved.ok) throw new Error('fixture must be approvable');
    await render(approved.batch);
    await click('Add row');
    expect(document.body.textContent).toContain('Adding a row withdraws that approval');
    await click('Cancel');
    await render(doc);
    await click('Add row');
    expect(document.body.textContent).not.toContain('withdraws that approval');
  });

  it('shows the template column labels and adds a column the rows do not have yet', async () => {
    const doc = buildBatch(invoiceInput());
    const profile: ExtractionProfile = { id: 'shipping', name: 'Shipping', fields: [{ key: 'supplier_name', label: 'Supplier', type: 'text' }], rowFields: [{ key: 'description', label: 'Item', type: 'text' }, { key: 'colour', label: 'Colour', type: 'text' }] };
    saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: profile.id }, profile);
    const onSaved = vi.fn();
    await render(doc, { onSaved });
    await click('Add row');
    expect([...document.querySelectorAll('label')].some(l => l.textContent === 'Colour')).toBe(true);
    expect([...document.querySelectorAll('label')].some(l => l.textContent === 'Item')).toBe(true);
    await fill('Colour', 'Blue'); await click('Save row'); await saved(onSaved);
    expect((onSaved.mock.calls[0][0] as Batch).transactions[0].data.line_items).toHaveLength(2);
  });
});

describe('rowColumns', () => {
  const tx = () => buildBatch(invoiceInput()).transactions[0];
  it('lists the columns the rows have, in order', () => {
    expect(rowColumns(tx()).map(c => c.key)).toEqual(Object.keys((tx().data.line_items as Record<string, unknown>[])[0]));
  });
  it('appends the other columns of the template and carries their declared type and required mark', () => {
    const t = tx();
    t.field_types = { '/line_items/0/description': 'text', '/line_items/0/amount': 'amount' };
    const profile: ExtractionProfile = { id: 'p', name: 'P', fields: [], rowFields: [{ key: 'colour', label: 'Colour', type: 'code', required: true }, { key: 'description', label: 'Item', type: 'text' }] };
    const columns = rowColumns(t, profile);
    expect(columns.at(-1)).toEqual({ key: 'colour', label: 'Colour', type: 'code', required: true });
    expect(columns.find(c => c.key === 'amount')?.type).toBe('amount'); // declared by an existing row
    expect(columns.filter(c => c.key === 'description')).toHaveLength(1); // no duplicate for a column both have
  });
  it('falls back to the standard Auto row columns when there is nothing to go by', () => {
    const t = tx(); t.data.line_items = [];
    expect(rowColumns(t).map(c => c.key)).toEqual(['stock_code', 'description', 'quantity', 'uom', 'unit_price', 'amount']);
  });
  it('is usable on its own as a dialog', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('Nope'));
    await act(async () => root.render(<AddRow columns={[{ key: 'description' }]} label={key => key} rowNumber={3} approved={false} onClose={() => {}} onAdd={onAdd} />));
    await fill('description', 'x'); await click('Save row');
    expect(onAdd).toHaveBeenCalledWith({ description: 'x' }, 'Row missing from the extraction');
    expect(document.body.textContent).toContain('Nope');
  });
});
