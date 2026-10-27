import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { recomputeIssues } from '../contract/review';
import type { Batch } from '../contract/types';
import * as db from '../lib/db';
import { loadSettings } from '../lib/settings';
import { clearLocalData } from './storage';
import { ValidationPage } from './pages/ValidationPage';

let container: HTMLDivElement;
let root: Root;
const render = async (node: ReactNode) => { await act(async () => { root.render(node); }); };
const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const button = (label: string) => [...document.querySelectorAll('button')].find(e => e.textContent === label)!;
const region = (label: string) => container.querySelector(`[aria-label="${label}"]`)!;
const control = (label: string) => [...document.querySelectorAll('label')].find(e => e.textContent?.startsWith(label))!.control as HTMLInputElement | HTMLSelectElement;
const select = async (label: string, value: string) => { await act(async () => { const e = control(label); e.value = value; e.dispatchEvent(new Event('change', { bubbles: true })); }); };
const input = async (label: string, value: string) => { await act(async () => { const e = control(label); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(e, value); e.dispatchEvent(new Event('input', { bubbles: true })); }); };
function fixture(id: string, missing = false) {
  const value = invoiceInput(); value.batchId = id; value.file.file_id = `file_${id}`; value.file.filename = `${id}.pdf`;
  if (missing) value.output.fields = value.output.fields.filter(f => f.key !== 'supplier_name');
  return buildBatch(value);
}
function StoredPage({ initial }: { initial: Batch[] }) {
  const [docs, setDocs] = useState(initial);
  return <ValidationPage docs={docs} settings={loadSettings()} refresh={async () => setDocs(await db.listBatches())} />;
}
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData(); localStorage.clear();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('aggregates both batches, filters issues and links evidence to its transaction', async () => {
  const docs = [fixture('good'), fixture('missing', true)];
  await render(<ValidationPage docs={docs} settings={loadSettings()} refresh={async () => {}} />);
  expect(container.querySelector('h1')?.textContent).toBe('Validation');
  for (const severity of ['blocking', 'error', 'warning', 'info']) {
    const count = docs.flatMap(b => b.issues).filter(i => i.status === 'open' && i.severity === severity).length;
    expect(region('Issue counters').textContent).toContain(`Open ${severity}: ${count}`);
  }
  expect(container.textContent).toContain('1 eligible · 1 blocked transactions');
  await select('Rule', 'LOW_CONFIDENCE');
  expect(region('Validation issues').querySelectorAll('tbody tr')).toHaveLength(2);
  await select('Batch', 'missing');
  expect(region('Validation issues').querySelectorAll('tbody tr')).toHaveLength(1);
  expect(region('Validation issues').querySelector('tbody a')?.getAttribute('href')).toBe('#/doc/missing/t_1');
  await select('Severity', 'blocking');
  expect(region('Validation issues').textContent).toContain('No matching issues');
  await select('Rule', 'MISSING_REQUIRED');
  expect(region('Validation issues').textContent).toContain('/supplier_name: required field is missing.');
  expect(region('Validation issues').textContent).toContain('Cannot waive');
  expect(region('Validation issues').querySelector('button')).toBeNull();
  await select('Status', 'resolved');
  expect(region('Validation issues').textContent).toContain('No matching issues');
  await input('Search rules', 'TOTALS_MISMATCH'); await click(button('TOTALS_MISMATCH'));
  expect(region('Rule details').textContent).toContain('authorized reconciliation exception');
  expect(region('Rule details').textContent).toContain('Waivable: Yes');
});

it('persists an audited waiver, retains it after revalidation and reopens with history', async () => {
  const original = fixture('stored'); await db.putBatch(original);
  const low = original.issues.find(i => i.rule_code === 'LOW_CONFIDENCE')!;
  await render(<StoredPage initial={[original]} />);
  await select('Rule', 'LOW_CONFIDENCE'); await click(button('Waive'));
  await input('Waiver reason', 'short'); expect(button('Save waiver').disabled).toBe(true);
  await input('Waiver reason', 'Verified against the source'); await click(button('Save waiver'));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  let saved = (await db.getBatch('stored'))!;
  expect(saved.issues.find(i => i.issue_id === low.issue_id)).toMatchObject({ status: 'waived', waiver_review_id: saved.reviews.at(-1)!.review_id });
  expect(saved.reviews.at(-1)).toMatchObject({ action: 'waive', reason: 'Verified against the source' });
  expect(region('Issue counters').textContent).toContain('Waived: 1');
  await click(button('Revalidate all'));
  await vi.waitFor(() => expect(container.textContent).toContain('integrity errors'));
  saved = (await db.getBatch('stored'))!;
  expect(saved.issues.find(i => i.issue_id === low.issue_id)?.status).toBe('waived');
  await select('Status', 'waived'); await click(button('Reopen'));
  await input('Waiver reason', 'New evidence needs inspection'); await click(button('Save reopen'));
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  saved = (await db.getBatch('stored'))!;
  expect(saved.issues.find(i => i.issue_id === low.issue_id)).toMatchObject({ status: 'open', waiver_review_id: null });
  expect(saved.reviews.map(r => r.action)).toEqual(['waive', 'reject']);
});

it('revalidates only the selected batch, then all batches, with before and after counts', async () => {
  const a = fixture('a', true), b = fixture('b', true);
  a.transactions[0].data.supplier_name = 'Restored vendor';
  b.transactions[0].data.supplier_name = 'Restored vendor';
  await db.putBatch(a); await db.putBatch(b);
  const before = a.issues.filter(i => i.status === 'open').length;
  await render(<StoredPage initial={[a, b]} />);
  await click(region('Batches').querySelector('tbody button')!);
  await vi.waitFor(() => expect(container.textContent).toContain(`a: ${before} →`));
  expect((await db.getBatch('a'))!.issues.find(i => i.rule_code === 'MISSING_REQUIRED')?.status).toBe('resolved');
  expect((await db.getBatch('b'))!.issues.find(i => i.rule_code === 'MISSING_REQUIRED')?.status).toBe('open');
  await click(button('Revalidate all'));
  await vi.waitFor(() => expect(container.textContent).toContain('b:'));
  expect((await db.getBatch('b'))!.issues).toEqual(recomputeIssues(b).issues);
  expect(region('Issue counters').textContent).toContain('Resolved: 2');
});

it('shows storage failures without falsely marking a waiver saved', async () => {
  const original = fixture('failure'); await db.putBatch(original);
  await render(<StoredPage initial={[original]} />);
  await select('Rule', 'LOW_CONFIDENCE'); await click(button('Waive'));
  await input('Waiver reason', 'Checked original source');
  vi.spyOn(db, 'putBatch').mockRejectedValueOnce(new Error('Storage unavailable'));
  await click(button('Save waiver'));
  await vi.waitFor(() => expect(document.body.textContent).toContain('Storage unavailable'));
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(await db.getBatch('failure')).toEqual(original);
});

it('distinguishes loading from an empty store and disables revalidation', async () => {
  const props = { docs: [], settings: loadSettings(), refresh: async () => {} };
  await render(<ValidationPage {...props} loading />);
  expect(container.textContent).toContain('Loading stored batches');
  expect(button('Revalidate all').disabled).toBe(true);
  await render(<ValidationPage {...props} />);
  expect(container.textContent).toContain('No stored batches. Upload documents');
  expect(container.textContent).toContain('0 eligible · 0 blocked transactions');
});
