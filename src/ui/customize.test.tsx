import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Workspace } from './pages/Workspace';
import { clearLocalData } from './storage';
import { loadProfiles, saveBatchMode } from '../lib/profiles';
import type { ExtractionProfile } from '../lib/agent/contract';
import { buildBatch } from '../contract/build';
import { correctField } from '../contract/review';
import { invoiceInput } from '../contract/fixtures';

let root: Root;
let container: HTMLDivElement;
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name) as HTMLButtonElement | undefined;
const click = async (name: string) => { await act(async () => { button(name)!.click(); }); };
const fill = async (label: string, value: string) => { await act(async () => { const element = [...document.querySelectorAll('input')].find(input => input.id === [...document.querySelectorAll('label')].find(l => l.textContent === label)?.htmlFor)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const value = (label: string) => ([...document.querySelectorAll('label')].find(l => l.textContent === label)?.control as HTMLInputElement | undefined)?.value;
const render = async (props: Partial<Parameters<typeof Workspace>[0]> = {}) => {
  const doc = props.doc ?? buildBatch(invoiceInput());
  await act(async () => root.render(<Workspace doc={doc} onSaved={() => {}} {...props} />));
  return doc;
};
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('offers Customize fields only where a document can be read again', async () => {
  await render();
  expect(button('Customize fields')).toBeUndefined();
  await render({ onReextract: () => {} });
  expect(button('Customize fields')).toBeDefined();
});

it('starts an Auto result from its own fields, adds a field with a derived key, and asks before replacing anything', async () => {
  const onReextract = vi.fn();
  const doc = buildBatch(invoiceInput());
  const reviewed = correctField(doc, doc.transactions[0].transaction_id, '/supplier_name', 'Corrected Supplier', 'Fix the name');
  await render({ doc: reviewed, onReextract });
  await click('Customize fields');
  expect(document.body.textContent).toContain('Customize fields');
  expect(value('Template name')).toBe('My template');
  expect(value('Header fields 1 label')).toBeDefined();
  const headerCount = [...document.querySelectorAll('label')].filter(l => /^Header fields \d+ label$/.test(l.textContent ?? '')).length;
  expect(headerCount).toBe(5);
  expect([...document.querySelectorAll('label')].some(l => l.textContent?.endsWith(' key'))).toBe(false); // technical keys stay hidden
  await click('Add field'); await fill(`Header fields ${headerCount + 1} label`, 'Batch No');
  await click('Save and extract again');
  expect(document.body.textContent).toContain('Extract this document again?');
  expect(document.body.textContent).toContain('1 review action');
  expect(document.body.textContent).toContain('nothing changes');
  expect(onReextract).not.toHaveBeenCalled(); // asked first, nothing started
  await click('Extract again');
  expect(onReextract).toHaveBeenCalledTimes(1);
  const profile = onReextract.mock.calls[0][0] as ExtractionProfile;
  expect(profile.name).toBe('My template');
  expect(profile.fields.at(-1)).toEqual({ key: 'batch_no', label: 'Batch No', type: 'text' });
  expect(profile.fields.slice(0, headerCount).map(f => f.key)).toEqual(expect.arrayContaining(['supplier_name', 'invoice_no', 'invoice_date', 'currency', 'total_amount']));
  expect(loadProfiles().find(p => p.name === 'My template')?.fields.some(f => f.key === 'batch_no')).toBe(true); // kept on the Templates page
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('says so when there is nothing to lose, and Back returns to editing without starting anything', async () => {
  const onReextract = vi.fn();
  await render({ onReextract });
  await click('Customize fields'); await click('Save and extract again');
  expect(document.body.textContent).toContain('no corrections or approvals');
  await click('Back');
  expect(document.body.textContent).toContain('Template name');
  expect(onReextract).not.toHaveBeenCalled();
});

it('adds a column to the rows as well as a field to the header', async () => {
  const onReextract = vi.fn();
  await render({ onReextract });
  await click('Customize fields');
  const columns = [...document.querySelectorAll('label')].filter(l => /^Row columns \d+ label$/.test(l.textContent ?? '')).length;
  await click('Add column'); await fill(`Row columns ${columns + 1} label`, 'Colour');
  await click('Save and extract again'); await click('Extract again');
  const profile = onReextract.mock.calls[0][0] as ExtractionProfile;
  expect(profile.rowFields.at(-1)).toEqual({ key: 'colour', label: 'Colour', type: 'text' });
});

it('refuses an invalid template instead of starting an extraction, and Cancel keeps nothing', async () => {
  const onReextract = vi.fn();
  await render({ onReextract });
  await click('Customize fields');
  await fill('Template name', '');
  await click('Save and extract again');
  expect(document.body.textContent).toContain('Enter a template name.');
  expect(document.body.textContent).not.toContain('Extract this document again?');
  await fill('Template name', 'Discarded');
  await click('Cancel');
  expect(onReextract).not.toHaveBeenCalled();
  expect(loadProfiles().some(p => p.name === 'Discarded')).toBe(false);
});

it('Save template only keeps the template without reading the document again', async () => {
  const onReextract = vi.fn();
  await render({ onReextract });
  await click('Customize fields'); await fill('Template name', 'Kept for later');
  await click('Save template only');
  expect(document.body.textContent).toContain('Saved “Kept for later” on the Templates page.');
  expect(loadProfiles().some(p => p.name === 'Kept for later')).toBe(true);
  expect(onReextract).not.toHaveBeenCalled();
});

it('starts a templated result from its own template and never renames a saved key', async () => {
  const onReextract = vi.fn();
  const doc = buildBatch(invoiceInput());
  const shipping: ExtractionProfile = { id: 'shipping', name: 'Shipping', fields: [{ key: 'tracking_no', label: 'Tracking number', type: 'code' }], rowFields: [{ key: 'box_code', label: 'Box code', type: 'code' }] };
  doc.transactions[0].data = { tracking_no: 'TRACK-1', line_items: [{ box_code: 'BOX-1' }] };
  saveBatchMode(doc.batch.batch_id, { kind: 'targeted', profileId: shipping.id }, shipping);
  await render({ doc, onReextract });
  await click('Customize fields');
  expect(value('Template name')).toBe('Shipping (edited)');
  expect(value('Header fields 1 label')).toBe('Tracking number');
  await fill('Header fields 1 label', 'Parcel reference'); // a saved field may be relabelled, but its key must not move
  await click('Save and extract again'); await click('Extract again');
  const profile = onReextract.mock.calls[0][0] as ExtractionProfile;
  expect(profile.fields[0]).toMatchObject({ key: 'tracking_no', label: 'Parcel reference' });
  expect(profile.rowFields[0].key).toBe('box_code');
});

it('freezes the current result while the new one is being read', async () => {
  const doc = buildBatch(invoiceInput());
  await render({ doc, onReextract: () => {}, locked: true });
  expect(document.body.textContent).toContain('This result is locked');
  expect(button('Approve')!.disabled).toBe(true);
  expect(button('Customize fields')!.disabled).toBe(true);
  const edits = [...document.querySelectorAll('button')].filter(b => /^Edit /.test(b.textContent ?? '') || /^Edit /.test(b.getAttribute('aria-label') ?? ''));
  expect(edits.length).toBeGreaterThan(0);
  expect(edits.every(b => b.disabled)).toBe(true);
  expect(button('Add row column')!.disabled).toBe(true);
});

it('disables a correction already open when re-extraction locks the result', async () => {
  const doc = buildBatch(invoiceInput());
  await render({ doc, onReextract: () => {} });
  await click('Edit Supplier name');
  expect(button('Save correction')!.disabled).toBe(false);
  await render({ doc, onReextract: () => {}, locked: true });
  expect(button('Save correction')!.disabled).toBe(true);
});
