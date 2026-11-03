import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Workspace } from './pages/Workspace';
import { ProfileEditor } from './ProfileEditor';
import { clearLocalData } from './storage';
import { loadProfiles, saveBatchMode, saveProfiles } from '../lib/profiles';
import type { ExtractionProfile } from '../lib/agent/contract';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name) as HTMLButtonElement | undefined;
const click = async (name: string) => { await act(async () => { button(name)!.click(); }); };
const control = (label: string) => [...document.querySelectorAll('label')].find(l => l.textContent === label)?.control as HTMLInputElement | HTMLSelectElement;
const fill = async (label: string, value: string) => { await act(async () => { const element = control(label) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const choose = async (label: string, value: string) => { await act(async () => { const element = control(label) as HTMLSelectElement; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })); }); };
const render = async (doc: Batch, props: Partial<Parameters<typeof Workspace>[0]> = {}) => { await act(async () => root.render(<Workspace doc={doc} onSaved={() => {}} onReextract={() => {}} {...props} />)); };
const mine = (extra: Partial<ExtractionProfile> = {}): ExtractionProfile => ({ id: 'abc-template', name: 'ABC invoices', fields: [{ key: 'supplier_name', label: 'Supplier name', type: 'text' }, { key: 'invoice_no', label: 'Invoice no', type: 'code' }], rowFields: [{ key: 'description', label: 'Description', type: 'text' }], match: { party: 'ABC TRADING LTD', documentType: 'purchase_invoice' }, ...extra });
const text = () => document.body.textContent ?? '';
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Save as template in review', () => {
  it('keeps what the document contains as a template and remembers who it is from', async () => {
    await render(buildBatch(invoiceInput()));
    expect(loadProfiles().some(p => !p.builtin)).toBe(false);
    await click('Save as template');
    const saved = loadProfiles().filter(p => !p.builtin);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('ABC Trading Pte Ltd purchase invoice');
    expect(saved[0].match).toEqual({ party: 'ABC Trading Pte Ltd', documentType: 'purchase_invoice' });
    expect(saved[0].fields.map(f => f.key)).toEqual(expect.arrayContaining(['supplier_name', 'invoice_no', 'total_amount']));
    expect(saved[0].rowFields.map(f => f.key)).toEqual(expect.arrayContaining(['description', 'amount']));
    expect(text()).toContain('It will be suggested for the next purchase invoice from ABC Trading Pte Ltd.');
  });

  it('saves only once, and does not suggest the template it has just saved back', async () => {
    await render(buildBatch(invoiceInput()));
    await click('Save as template');
    expect(button('Save as template')!.disabled).toBe(true);
    expect(text()).not.toContain('You have a template for');
    expect(loadProfiles().filter(p => !p.builtin)).toHaveLength(1);
  });

  it('numbers the name when one with that name exists', async () => {
    saveProfiles([mine({ id: 'old', name: 'ABC Trading Pte Ltd purchase invoice', match: { party: 'Someone else' } })]);
    await render(buildBatch(invoiceInput()));
    await click('Save as template');
    expect(loadProfiles().filter(p => !p.builtin).map(p => p.name).sort()).toEqual(['ABC Trading Pte Ltd purchase invoice', 'ABC Trading Pte Ltd purchase invoice 2']);
  });

  it('says so when the document has no supplier to match it by, and keeps the template without a match', async () => {
    const doc = buildBatch(invoiceInput()); doc.transactions[0].data.supplier_name = null;
    await render(doc);
    await click('Save as template');
    const saved = loadProfiles().find(p => !p.builtin)!;
    expect(saved.match).toBeUndefined();
    expect(saved.name).toBe('Purchase invoice template');
    expect(text()).toContain('no supplier or customer name to match it by');
  });

  it('is not offered for a document read with a template, nor where a document cannot be read again', async () => {
    const doc = buildBatch(invoiceInput());
    await render(doc, { onReextract: undefined });
    expect(button('Save as template')).toBeUndefined();
    saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: 'abc-template' }, mine());
    await render(doc);
    expect(button('Save as template')).toBeUndefined();
  });

  it('is disabled while the result is locked', async () => {
    await render(buildBatch(invoiceInput()), { locked: true });
    expect(button('Save as template')!.disabled).toBe(true);
  });
});

describe('a saved template is suggested for the next document like it', () => {
  it('suggests it for a document from the same supplier, and reading again goes through the usual question', async () => {
    saveProfiles([mine()]);
    const onReextract = vi.fn();
    await render(buildBatch(invoiceInput()), { onReextract });
    expect(text()).toContain('You have a template for documents from ABC Trading Pte Ltd: “ABC invoices”.');
    expect(onReextract).not.toHaveBeenCalled();
    await click('Read again with “ABC invoices”');
    expect(text()).toContain('Extract this document again?');
    expect(text()).toContain('“ABC invoices”');
    expect(onReextract).not.toHaveBeenCalled(); // asked first
    await click('Extract again');
    expect(onReextract).toHaveBeenCalledTimes(1);
    expect((onReextract.mock.calls[0][0] as ExtractionProfile).id).toBe('abc-template'); // the saved template itself, not a copy
    expect((onReextract.mock.calls[0][0] as ExtractionProfile).match).toEqual(mine().match);
  });

  it('lets the user back out to edit the template first', async () => {
    saveProfiles([mine()]);
    await render(buildBatch(invoiceInput()));
    await click('Read again with “ABC invoices”'); await click('Back');
    expect(text()).toContain('Template name');
    expect((control('Template name') as HTMLInputElement).value).toBe('ABC invoices');
  });

  it('can be dismissed', async () => {
    saveProfiles([mine()]);
    await render(buildBatch(invoiceInput()));
    await click('Not now');
    expect(text()).not.toContain('You have a template for');
  });

  it('suggests nothing for another supplier, another document type, or a template with no condition', async () => {
    saveProfiles([mine({ id: 'a', name: 'Other supplier', match: { party: 'XYZ Corp' } }), mine({ id: 'b', name: 'Sales only', match: { documentType: 'sales_invoice' } }), mine({ id: 'c', name: 'No condition', match: undefined })]);
    await render(buildBatch(invoiceInput()));
    expect(text()).not.toContain('You have a template for');
  });

  it('suggests by document type alone when that is all the template says, and shows at most two, best first', async () => {
    saveProfiles([
      mine({ id: 't', name: 'Any purchase invoice', match: { documentType: 'purchase_invoice' } }), mine({ id: 's', name: 'Supplier only', match: { party: 'ABC Trading' } }),
      mine({ id: 'b', name: 'Supplier and type' }), mine({ id: 'z', name: 'Zed type only', match: { documentType: 'purchase_invoice' } }),
    ]);
    await render(buildBatch(invoiceInput()));
    const suggested = [...document.querySelectorAll('button')].map(b => b.textContent).filter(t => t?.startsWith('Read again with'));
    expect(suggested).toEqual(['Read again with “Supplier and type”', 'Read again with “Supplier only”']);
    expect(text()).toContain('documents from ABC Trading Pte Ltd');
  });

  it('is not shown for a document that was read with a template already', async () => {
    saveProfiles([mine()]);
    const doc = buildBatch(invoiceInput());
    saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: 'abc-template' }, mine());
    await render(doc);
    expect(text()).not.toContain('You have a template for');
  });

  it('cannot be taken while the result is locked', async () => {
    saveProfiles([mine()]);
    await render(buildBatch(invoiceInput()), { locked: true });
    expect(button('Read again with “ABC invoices”')!.disabled).toBe(true);
  });
});

describe('who a template is for, in the template editor', () => {
  it('sets, shows and clears the supplier and document type', async () => {
    await act(async () => root.render(<ProfileEditor />));
    await click('Create template');
    await fill('Template name', 'ABC purchase orders');
    await click('Add field'); await fill('Header fields 1 label', 'PO no');
    await fill('Suggest for supplier or customer (optional)', 'ABC Trading');
    await choose('Suggest for document type (optional)', 'purchase_order');
    await click('Save template');
    const saved = loadProfiles().find(p => p.name === 'ABC purchase orders')!;
    expect(saved.match).toEqual({ party: 'ABC Trading', documentType: 'purchase_order' });
    expect(text()).toContain('Suggested for documents from ABC Trading, purchase order.');
    await click('Edit ABC purchase orders');
    expect((control('Suggest for supplier or customer (optional)') as HTMLInputElement).value).toBe('ABC Trading');
    await fill('Suggest for supplier or customer (optional)', ''); await choose('Suggest for document type (optional)', '');
    await click('Save template');
    expect(loadProfiles().find(p => p.name === 'ABC purchase orders')!.match).toBeUndefined();
    expect(text()).not.toContain('Suggested for');
  });

  it('refuses a supplier name that is only spaces', async () => {
    await act(async () => root.render(<ProfileEditor />));
    await click('Create template'); await fill('Template name', 'Spaces');
    await click('Add field'); await fill('Header fields 1 label', 'PO no');
    await fill('Suggest for supplier or customer (optional)', '   ');
    await click('Save template');
    expect(text()).toContain('Enter a supplier or customer name for the suggestion, or leave it empty.');
    expect(loadProfiles().some(p => p.name === 'Spaces')).toBe(false);
  });

  it('only offers real document types', async () => {
    await act(async () => root.render(<ProfileEditor />));
    await click('Create template');
    const options = [...(control('Suggest for document type (optional)') as HTMLSelectElement).options].map(o => o.value);
    expect(options[0]).toBe(''); expect(options).toContain('purchase_order'); expect(options).not.toContain('unknown');
  });
});
