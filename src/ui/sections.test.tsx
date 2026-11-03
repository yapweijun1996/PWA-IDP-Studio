import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Workspace } from './pages/Workspace';
import { CustomizeFields } from './CustomizeFields';
import { clearLocalData } from './storage';
import { loadProfiles, saveBatchMode } from '../lib/profiles';
import type { ExtractionProfile } from '../lib/agent/contract';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;
const click = async (name: string) => { await act(async () => { button(name)!.click(); }); };
const control = (label: string) => [...document.querySelectorAll('label')].find(l => l.textContent === label)?.control as HTMLInputElement | HTMLSelectElement;
const fill = async (label: string, value: string) => { await act(async () => { const element = control(label) as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const choose = async (label: string, value: string) => { await act(async () => { const element = control(label) as HTMLSelectElement; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('change', { bubbles: true })); }); };
const render = async (doc: Batch, props: Partial<Parameters<typeof Workspace>[0]> = {}) => { await act(async () => root.render(<Workspace doc={doc} onSaved={() => {}} {...props} />)); };
const section = (name: string) => container.querySelector(`section[aria-label="${name}"]`) as HTMLElement | null;
const sections = () => [...container.querySelectorAll('section[aria-label="Document info"], section[aria-label="Row data"], section[aria-label="Footer"]')].map(s => s.getAttribute('aria-label'));
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('the review screen shows three sections', () => {
  it('lists Document info, then Row data, then Footer, like the printed document', async () => {
    await render(buildBatch(invoiceInput()));
    expect(sections()).toEqual(['Document info', 'Row data', 'Footer']);
    expect([...container.querySelectorAll('section[aria-label] > h3')].map(h => h.textContent)).toEqual(['Document info', 'Row data', 'Footer']);
  });

  it('puts the totals in the footer and everything else printed once in the document info', async () => {
    await render(buildBatch(invoiceInput()));
    const info = section('Document info')!.textContent!, footer = section('Footer')!.textContent!;
    for (const name of ['Supplier name', 'Invoice no', 'Invoice date', 'Currency']) { expect(info).toContain(name); expect(footer).not.toContain(name); }
    expect(footer).toContain('Total amount'); expect(info).not.toContain('Total amount');
    expect(section('Row data')!.querySelector('table')).not.toBeNull(); // the rows are Row Data
  });

  it('keeps every field editable in its section', async () => {
    const onSaved = vi.fn();
    await render(buildBatch(invoiceInput()), { onSaved });
    expect([...section('Footer')!.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Edit Total amount')).toBe(true);
    expect([...section('Document info')!.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Edit Supplier name')).toBe(true);
    await click('Edit Total amount');
    await fill('Edit total_amount', '1,300.00');
    await click('Save correction');
    await act(async () => { await vi.waitFor(() => { if (!onSaved.mock.calls.length) throw new Error('not saved'); }, { timeout: 4000 }); });
    expect((onSaved.mock.calls[0][0] as Batch).transactions[0].data.total_amount).toBe('1300.00');
  });

  it('checks the rows against the grand total in the footer, and says what to do when they disagree', async () => {
    const doc = buildBatch(invoiceInput());
    await render(doc);
    const ok = section('Footer')!.querySelector('[role="group"][aria-label="Totals check"]')!.textContent!;
    expect(ok).toContain('Rows add up to 1280.00'); expect(ok).toContain('Matches');
    expect(section('Footer')!.textContent).not.toContain('The rows and the grand total disagree');
    const wrong = structuredClone(doc); wrong.transactions[0].data.total_amount = '99.00';
    await render(wrong);
    const bad = section('Footer')!.textContent!;
    expect(bad).toContain('Does not match'); expect(bad).toContain('grand total 99.00');
    expect(bad).toContain('waive the mismatch under Issues');
  });

  it('shows the tax in the check when the document prints one', async () => {
    const doc = buildBatch(invoiceInput());
    doc.transactions[0].data = { invoice_no: 'A', tax_amount: '53.88', total_amount: '727.38', line_items: [{ description: 'x', amount: '673.50' }] };
    await render(doc);
    const check = section('Footer')!.querySelector('[role="group"]')!.textContent!;
    expect(check).toContain('Rows add up to 673.50'); expect(check).toContain('tax 53.88'); expect(check).toContain('grand total 727.38'); expect(check).toContain('Matches');
    expect([...section('Footer')!.querySelectorAll('button')].some(b => b.getAttribute('aria-label') === 'Edit Tax amount')).toBe(true); // a footer line, editable
  });

  it('follows the template: a field the template puts in the footer is shown there, and one it keeps in the info stays there', async () => {
    const doc = buildBatch(invoiceInput());
    doc.transactions[0].data = { po_no: 'PO-1', handling: '5.00', discount_code: 'SPRING', total_amount: '105.00', line_items: [{ description: 'x', amount: '100.00' }] };
    const profile: ExtractionProfile = { id: 'p', name: 'P', rowFields: [{ key: 'description', label: 'Item', type: 'text' }, { key: 'amount', label: 'Amount', type: 'amount' }], fields: [
      { key: 'po_no', label: 'PO no', type: 'code' }, { key: 'handling', label: 'Handling charge', type: 'amount', section: 'footer' },
      { key: 'discount_code', label: 'Discount code', type: 'code' }, { key: 'total_amount', label: 'Grand total', type: 'amount', section: 'info' }] };
    saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: 'p' }, profile);
    await render(doc);
    expect(section('Footer')!.textContent).toContain('Handling charge');
    expect(section('Footer')!.textContent).not.toContain('Discount code');
    expect(section('Document info')!.textContent).toContain('Discount code'); // mentions "discount" but is a code
    expect(section('Document info')!.textContent).toContain('Grand total'); // the template moved it up
  });

  it('keeps a required total that is missing visible in the footer, so it gets filled in', async () => {
    const doc = buildBatch(invoiceInput());
    doc.transactions[0].data = { invoice_no: 'A' };
    await render(doc);
    expect(section('Footer')!.textContent).toContain('Total amount');
    expect(section('Footer')!.textContent).toContain('Missing value');
  });

  it('leaves the footer out when the document type has no totals and the document has no footer fields', async () => {
    const doc = buildBatch(invoiceInput());
    doc.documents[0].document_type = 'unknown'; doc.transactions[0].transaction_type = 'unknown';
    doc.transactions[0].data = { reference: 'A' };
    await render(doc);
    expect(sections()).toEqual(['Document info', 'Row data']);
  });

  it('offers the same data grouped, as an optional view next to the flat JSON', async () => {
    await render(buildBatch(invoiceInput()));
    await act(async () => { ([...document.querySelectorAll('[role="tab"]')].find(t => t.textContent === 'JSON') as HTMLElement).click(); });
    const flat = JSON.parse(container.querySelector('pre')!.textContent!);
    expect(Object.keys(flat)).toContain('line_items');
    await act(async () => { (container.querySelector('input[type="radio"][value="grouped"]') as HTMLInputElement).click(); });
    const grouped = JSON.parse(container.querySelector('pre')!.textContent!);
    expect(Object.keys(grouped)).toEqual(['document_type', 'document', 'rows', 'footer']);
    expect(grouped.footer).toEqual({ total_amount: flat.total_amount });
    expect(grouped.rows).toEqual(flat.line_items);
    await act(async () => { ([...document.querySelectorAll('button')].find(b => b.textContent === 'Export') as HTMLElement).click(); });
    expect([...document.querySelectorAll('[role="menuitem"]')].map(m => m.textContent)).toEqual(['Clean JSON', 'Grouped JSON', 'Full evidence JSON']);
  });
});

describe('Section in the field form', () => {
  const start = (): ExtractionProfile => ({ id: 'p', name: 'Mine', rowFields: [{ key: 'description', label: 'Description', type: 'text' }], fields: [{ key: 'supplier_name', label: 'Supplier name', type: 'text' }, { key: 'total_amount', label: 'Total amount', type: 'amount' }] });
  const open = async (onExtract = vi.fn()) => { await act(async () => root.render(<CustomizeFields start={start()} reviewCount={0} documentCount={1} onClose={() => {}} onExtract={onExtract} />)); return onExtract; };

  it('shows where each field will land: totals in the footer, everything else in the document info', async () => {
    await open();
    expect(control('Header fields 1 section').value).toBe('info');
    expect(control('Header fields 2 section').value).toBe('footer');
    expect(document.querySelectorAll('select[aria-label*="Row columns"], label').length).toBeGreaterThan(0);
    expect([...document.querySelectorAll('label')].some(l => /^Row columns \d+ section$/.test(l.textContent ?? ''))).toBe(false); // rows are always Row Data
  });

  it('puts a new field named like a charge in the footer by itself, and lets the user override it either way', async () => {
    const onExtract = await open();
    await click('Add field'); await fill('Header fields 3 label', 'Shipping Fee');
    expect(control('Header fields 3 section').value).toBe('footer'); // from its name, nothing chosen yet
    await click('Add field'); await fill('Header fields 4 label', 'Handling');
    expect(control('Header fields 4 section').value).toBe('info');
    await choose('Header fields 4 section', 'footer'); // no name says it, so the user says it
    await choose('Header fields 2 section', 'info'); // and the user can move a total up
    await click('Save and extract again'); await click('Extract again');
    const profile = onExtract.mock.calls[0][0] as ExtractionProfile;
    expect(profile.fields.map(f => [f.key, f.section])).toEqual([['supplier_name', undefined], ['total_amount', 'info'], ['shipping_fee', undefined], ['handling', 'footer']]);
    expect(loadProfiles().find(p => p.name === 'Mine')?.fields.find(f => f.key === 'handling')?.section).toBe('footer');
  });
});
