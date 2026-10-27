import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBatch } from '../../contract/build';
import { invoiceInput } from '../../contract/fixtures';
import { validateBatch } from '../../contract/validate';
import { JsonExplorer } from './JsonExplorer';
import type { Settings } from '../../lib/settings';
import { clearProfiles } from '../../lib/profiles';
let host: HTMLDivElement; let root: Root;
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
describe('JsonExplorer', () => {
beforeEach(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; clearProfiles(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
  else Reflect.deleteProperty(document, 'execCommand');
});
const props = { settings: {} as Settings, refresh: async () => {} };
function click(text: string) { act(() => [...host.querySelectorAll<HTMLElement>('button,[role=treeitem]')].find(n => n.textContent === text || n.getAttribute('aria-label') === text)!.click()); }
it('handles loading and an empty store', () => {
  act(() => root.render(<JsonExplorer {...props} docs={[]} loading />)); expect(host.textContent).toContain('Loading stored batches');
  act(() => root.render(<JsonExplorer {...props} docs={[]} />)); expect(host.textContent).toContain('No stored batches');
});
it('inspects the shared transaction export and links evidence without changing the batch', () => {
  const batch = buildBatch(invoiceInput()); const original = JSON.stringify(batch);
  act(() => root.render(<JsonExplorer {...props} docs={[batch]} />));
  expect(host.textContent).toContain('Valid'); expect(host.textContent).toContain('Export-eligible transaction ids: t_1');
  click('Transaction'); expect(host.textContent).toContain('document_type:'); expect(host.textContent).toContain('INV-2026-1042');
  click('/invoice_no'); expect(host.querySelector('a[href="#/doc/batch_test/t_1"]')?.textContent).toBe('Open evidence in Workspace');
  click('Reviews'); expect(host.querySelector('[role=treeitem]')?.textContent).toContain('Array (0)');
  expect(JSON.stringify(batch)).toBe(original);
});
it('recomputes invalidity instead of trusting stored flags and displays validator messages', () => {
  const batch = buildBatch(invoiceInput()); batch.schema_version = 'broken' as '2.0.0';
  const result = validateBatch(batch);
  act(() => root.render(<JsonExplorer {...props} docs={[batch]} />));
  expect(host.textContent).toContain('Invalid'); expect(host.textContent).toContain('Export-eligible transaction ids: None');
  for (const entry of result.errors) { expect(host.textContent).toContain(entry.code); expect(host.textContent).toContain(entry.message); }
});
it('switches stored batches and inspects every non-transaction scope', () => {
  const first = buildBatch(invoiceInput());
  const second = structuredClone(first); second.batch.batch_id = 'second-batch';
  second.source_files[0].filename = 'second.pdf';
  act(() => root.render(<JsonExplorer {...props} docs={[first, second]} />));
  const selector = host.querySelector('select')!;
  expect([...selector.options].map(option => option.value)).toEqual([first.batch.batch_id, 'second-batch']);
  act(() => { selector.value = 'second-batch'; selector.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('batch_id: \"second-batch\"');
  expect(host.querySelector('[data-pointer="/batch"]')?.getAttribute('aria-expanded')).toBe('true');
  expect(host.querySelector('[data-pointer="/transactions/0"]')?.getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelector('[data-pointer="/transactions/0/data"]')).toBeNull();
  for (const [scope, count] of [['Evidence', second.evidence.length], ['Issues', second.issues.length], ['Reviews', second.reviews.length]] as const) {
    click(scope);
    expect(host.querySelector('[role=treeitem]')?.textContent).toContain(`Array (${count})`);
  }
  click('Validation');
  expect(host.querySelector('[role=tree]')?.textContent).toContain('export_eligible_transaction_ids:');
  click('Full batch');
  expect(host.querySelector('[role=tree]')?.textContent).toContain('schema_version: \"2.0.0\"');
});
it('provides an empty transaction state instead of attempting an unknown export', () => {
  const batch = buildBatch(invoiceInput()); batch.transactions = [];
  act(() => root.render(<JsonExplorer {...props} docs={[batch]} />));
  click('Transaction'); expect(host.textContent).toContain('No transactions');
  expect(host.querySelector('[role=tree]')).toBeNull();
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Download full JSON')?.disabled).toBe(true);
  expect(host.querySelector('input')).toBeNull();
  click('Full batch');
  expect(host.querySelector('[data-pointer="/transactions"]')?.textContent).toContain('Array (0)');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Download full JSON')?.disabled).toBe(false);
});
it('shows the empty transaction scope when the selected batch loses its transactions', () => {
  const batch = buildBatch(invoiceInput());
  act(() => root.render(<JsonExplorer {...props} docs={[batch]} />));
  click('Transaction');
  expect(host.querySelector('[data-pointer="/invoice_no"]')?.textContent).toContain('INV-2026-1042');
  act(() => root.render(<JsonExplorer {...props} docs={[{ ...batch, transactions: [] }]} />));
  expect(host.textContent).toContain('No transactions');
  expect(host.querySelector('[role=tree]')).toBeNull();
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Download full JSON')?.disabled).toBe(true);
});
it('retains the exact full envelope when clipboard access is refused', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  const batch = buildBatch(invoiceInput());
  act(() => root.render(<JsonExplorer {...props} docs={[batch]} />));
  await act(async () => click('Copy full JSON'));
  expect(host.textContent).toContain('Full JSON copy unavailable.');
  expect(host.querySelector('pre[aria-label=\"Manual full JSON copy\"]')?.textContent).toBe(JSON.stringify(batch, null, 2));
});
});
