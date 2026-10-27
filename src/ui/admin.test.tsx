import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';
import { batchSummary } from '../contract/view';
import { recomputeIssues } from '../contract/review';
import { Home } from './pages/Home';
import { Documents } from './pages/Documents';
import { ReviewQueue } from './pages/ReviewQueue';
import { Workspace } from './pages/Workspace';
import { SettingsPage } from './pages/Settings';
import { loadSettings } from '../lib/settings';
import { loadPreferences } from './preferences';
import { navItems, reviewRows } from './nav';
import { SearchInput, Sidebar, ThemeProvider } from '../ds';
import { EvidenceViewer } from '../ds/components/EvidenceViewer';
import { getBatch, getFile, listDocuments, putBatch, putFile } from '../lib/db';
import { clearLocalData, deleteLocalBatch } from './storage';
vi.mock('../lib/pdf', () => ({ renderFile: vi.fn(async () => [{ page: 1, width: 100, height: 100, data: 'AA==', mimeType: 'image/jpeg' }, { page: 2, width: 100, height: 100, data: 'AA==', mimeType: 'image/jpeg' }]) }));
let container: HTMLDivElement;
let root: Root;
const render = async (node: ReactNode) => { await act(async () => { root.render(node); }); };
const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const button = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === text || b.getAttribute('aria-label') === text)!;
const input = async (element: HTMLInputElement, value: string) => { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); };
const select = async (element: HTMLSelectElement, value: string) => { await act(async () => { element.value = value; element.dispatchEvent(new Event('change', { bubbles: true })); }); };
const fixture = (id: string, name = `${id}.pdf`) => { const value = invoiceInput(); value.batchId = id; value.file.file_id = `file_${id}`; value.file.filename = name; return buildBatch(value); };
beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData(); localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('Home stats use batchSummary; document type search and clear restore real uploads', async () => {
  const docs = [fixture('a', 'alpha.pdf'), fixture('b', 'beta.pdf')];
  function Page() { const [search, setSearch] = useState(''); return <><SearchInput value={search} onChange={setSearch} /><Home docs={docs} settings={loadSettings()} busy={null} onFiles={() => {}} search={search} /></>; }
  await render(<Page />);
  const totals = batchSummary(docs);
  expect(Array.from(container.querySelectorAll('.ds-stat-value')).map(n => n.textContent)).toEqual([String(totals.pages), String(totals.documents), String(totals.transactions)]);
  expect(Array.from(container.querySelectorAll('th')).map(n => n.textContent)).toContain('Actions');
  await click(container.querySelector('[aria-label="Open alpha.pdf"]')!);
  expect(location.hash).toContain('/doc/a');
  await input(container.querySelector('input[type="search"]')!, 'alpha');
  expect(container.querySelector('tbody')!.textContent).toContain('alpha.pdf'); expect(container.querySelector('tbody')!.textContent).not.toContain('beta.pdf');
  await click(container.querySelector('[aria-label="Clear search"]')!);
  expect(container.querySelector('tbody')!.textContent).toContain('beta.pdf');
  await input(container.querySelector('input[type="search"]')!, 'purchase invoice'); expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  await input(container.querySelector('input[type="search"]')!, 'no-such-upload');
  expect(container.querySelector('.ds-empty')?.textContent).toContain('No matching uploads');
  expect(container.querySelector('tbody')?.textContent).not.toContain('alpha.pdf');
  await click(container.querySelector('[aria-label="Clear search"]')!);
  expect(container.querySelector('tbody')?.textContent).toContain('alpha.pdf');
});
it('Documents sorts the whole result before pagination and filters by status', async () => {
  const docs = Array.from({ length: 12 }, (_, i) => fixture(String(i), `${String(12-i).padStart(2,'0')}.pdf`));
  docs[0].batch.status = 'failed';
  await render(<Documents docs={docs} search="" onDeleted={() => {}} />);
  await click(button('File name'));
  expect(container.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending');
  expect(container.querySelector('tbody td')!.textContent).toBe('01.pdf');
  await click(button('Next'));
  expect(container.querySelector('tbody td')!.textContent).toBe('11.pdf');
  await select(container.querySelector('select')!, 'failed');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(1); expect(container.querySelector('tbody td')!.textContent).toBe('12.pdf');
});
it('Review Queue orders by blockers and omits validated and approved transactions with no blockers', async () => {
  const good = fixture('good'); const bad = fixture('bad'); bad.transactions[0].data.currency = ''; bad.transactions[0].data.supplier_name = ''; const worse = recomputeIssues(bad);
  const mild = fixture('mild'); mild.transactions[0].status = 'draft';
  const docs = [good, mild, worse];
  await render(<ReviewQueue docs={docs} />);
  expect(container.querySelector('tbody td')!.textContent).toBe('bad.pdf');
  expect(reviewRows(docs).map(r => r.batch.batch.batch_id)).toEqual(['bad', 'mild']);
});
it('nav disables unavailable features with reasons and hides zero review badge', async () => {
  await render(<Sidebar items={navItems('home', 0)} />);
  for (const label of ['Label Studio', 'Templates', 'JSON Explorer', 'AI Agents', 'Validation']) {
    const link = Array.from(container.querySelectorAll('a')).find(n => n.querySelector('span')?.textContent === label)!;
    expect(link.getAttribute('aria-disabled')).toBe('true'); expect(link.hasAttribute('href')).toBe(false); expect(link.querySelector('.ds-badge')?.textContent).toBe('Coming soon');
    const description = document.getElementById(link.getAttribute('aria-describedby')!)!;
    expect(description.textContent).toContain('Coming soon');
  }
  const review = Array.from(container.querySelectorAll('a')).find(a => a.querySelector('span')?.textContent === 'Review Queue')!;
  expect(review.querySelector('.ds-badge')).toBeNull();
  await click(container.querySelector('[aria-label="Collapse sidebar"]')!);
  const disabled = container.querySelector('[aria-label="Label Studio"]')!;
  expect(disabled.querySelector('.ds-badge')).toBeNull();
  await act(async () => { disabled.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
  const tooltip = container.querySelector('[role="tooltip"]')!;
  expect(tooltip.textContent).toContain('Label Studio: Coming soon');
  expect(disabled.getAttribute('aria-describedby')?.split(' ')).toContain(tooltip.id);
});
it('Workspace selects field evidence on its page, records reason and enables approval after correction', async () => {
  let original = fixture('review'); original.pages.push({ ...structuredClone(original.pages[0]), page_number: 2 }); original.source_files[0].page_count = 2;
  original.documents[0].page_refs.push({ ...original.documents[0].page_refs[0], page_number: 2 });
  original.pages[1].regions[0].region_id = 'r_second'; original.documents[0].page_refs[1].region_id = 'r_second';
  original.evidence[0].sources[0].page_number = 2;
  original.transactions[0].data.currency = ''; original = recomputeIssues(original);
  await putFile(original.source_files[0].file_id, new Blob(['image'], { type: 'image/png' }));
  let saved: Batch | undefined;
  function Page() { const [doc, setDoc] = useState(original); return <Workspace doc={doc} onSaved={next => { saved = next; setDoc(next); }} />; }
  await render(<Page />);
  expect(button('Approve').disabled).toBe(true); expect(container.textContent).toContain('blocking issues before approval');
  expect(container.querySelectorAll('.ds-notice')).toHaveLength(1);
  expect(container.querySelector('.ds-notice')?.textContent).toContain('blockers.');
  await click(container.querySelector('a[href="#workspace-issues"]')!);
  expect(Array.from(container.querySelectorAll('[role="tab"]')).find(n => n.textContent?.startsWith('Issues'))?.getAttribute('aria-selected')).toBe('true');
  await click(Array.from(container.querySelectorAll('[role="tab"]')).find(n => n.textContent === 'Fields')!);
  await click(button('Supplier name'));
  expect(container.textContent).toContain('Page 2 of 2');
  await vi.waitFor(() => expect(container.querySelector('[data-testid="bbox"]')?.getAttribute('aria-label')).toContain('Supplier name (selected)'));
  await click(button('Edit Currency')); await input(container.querySelector('[aria-label="Edit currency"]') ?? container.querySelector('form input')!, 'SGD');
  const reason = container.querySelectorAll('form input')[1] as HTMLInputElement; await input(reason, 'Checked original');
  await act(async () => { container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await vi.waitFor(() => expect(saved?.transactions[0].data.currency).toBe('SGD'));
  expect(saved?.reviews.at(-1)?.reason).toBe('Checked original'); expect(button('Approve').disabled).toBe(false);
  await click(button('Approve')); await vi.waitFor(() => expect(saved?.transactions[0].status).toBe('approved'));
});
it('Home rejects TIFF and WebP through a visible notice without uploading them', async () => {
  const accepted: File[][] = [];
  await render(<Home docs={[]} settings={loadSettings()} busy={null} onFiles={files => accepted.push(files)} />);
  const chooser = container.querySelector('input[type="file"]')!;
  Object.defineProperty(chooser, 'files', { configurable: true, value: [new File(['tiff'], 'scan.tiff', { type: 'image/tiff' }), new File(['webp'], 'scan.webp', { type: 'image/webp' })] });
  await act(async () => { chooser.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(accepted).toEqual([]);
  expect(container.querySelector('.ds-notice')?.textContent).toContain('TIFF and WebP are not supported');
});
it('Workspace humanizes issues and switches clean and evidence JSON', async () => {
  const doc = fixture('json'); await render(<Workspace doc={doc} onSaved={() => {}} />);
  const issues = Array.from(container.querySelectorAll('[role="tab"]')).find(n => n.textContent?.startsWith('Issues'))!; await click(issues);
  expect(container.textContent).toContain('Low confidence'); expect(container.textContent).toContain('LOW_CONFIDENCE');
  await click(Array.from(container.querySelectorAll('[role="tab"]')).find(n => n.textContent === 'JSON')!);
  const clean = JSON.parse(container.querySelector('pre')!.textContent!); expect(clean.total_amount).toBe(doc.transactions[0].data.total_amount); expect(clean.schema_version).toBeUndefined();
  await click(container.querySelector('input[value="full"]')!); const full = JSON.parse(container.querySelector('pre')!.textContent!); expect(full.schema_version).toBe('2.0.0'); expect(full.evidence[0].sources[0].bbox).toEqual(doc.evidence[0].sources[0].bbox);
});
it('Settings clamps page limits, persists density and confirms clear without deleting unrelated storage', async () => {
  const doc = fixture('stored'); await putBatch(doc); await putFile(doc.source_files[0].file_id, new Blob(['original'])); localStorage.setItem('unrelated', 'keep');
  await render(<ThemeProvider><SettingsPage settings={loadSettings()} onChange={() => {}} batchCount={1} migration={{ migrated: 1, skipped: 0 }} /></ThemeProvider>);
  await input(container.querySelector('input[type="number"]')!, '700'); expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('500');
  await click(button('Save extraction settings')); expect(loadSettings().maxPages).toBe(500);
  await click(container.querySelector('input[value="compact"]')!); expect(loadPreferences().density).toBe('compact');
  await click(button('Clear all local data')); expect(document.querySelector('[role="dialog"]')?.textContent).toContain('provider API keys'); expect(await getBatch(doc.batch.batch_id)).toEqual(doc);
  await click(button('Delete all local data')); expect(await getBatch(doc.batch.batch_id)).toBeUndefined(); expect(await getFile(doc.source_files[0].file_id)).toBeUndefined(); expect(await listDocuments()).toEqual([]); expect(localStorage.getItem('unrelated')).toBe('keep');
});
it('batch delete removes unshared originals but preserves another batch reference', async () => {
  const a = fixture('one'); const second = invoiceInput(); second.batchId = 'two'; second.file.file_id = a.source_files[0].file_id; const b = buildBatch(second);
  await putBatch(a); await putBatch(b); await putFile(a.source_files[0].file_id, new Blob(['original']));
  await deleteLocalBatch(a); expect(await getBatch(a.batch.batch_id)).toBeUndefined(); expect(await getFile(a.source_files[0].file_id)).toBeDefined();
  await deleteLocalBatch(b); expect(await getFile(a.source_files[0].file_id)).toBeUndefined();
});
it('readonly viewer navigates unprocessed pages and clamps zoom controls', async () => {
  function Viewer() { const [page, setPage] = useState(1); return <EvidenceViewer pages={[{ number: 1, src: 'data:image/png;base64,AA==' }, { number: 2, pending: true }]} page={page} onPageChange={setPage} />; }
  await render(<Viewer />); await click(button('Next page')); expect(container.textContent).toContain('Page 2 not processed'); expect(button('Next page').disabled).toBe(true);
  await click(button('Previous page')); await click(container.querySelector('[aria-label="Zoom in"]')!); expect(container.querySelector('.ds-evidence-page')?.getAttribute('style')).toBe('width: 125%;'); await click(button('Fit width')); expect(container.querySelector('.ds-evidence-page')?.getAttribute('style')).toBe('width: 100%;');
});
it('deleting a migrated upload removes only its migration source so it cannot reappear', async () => {
  const migrated = invoiceInput(); migrated.batchId = 'legacy_old'; migrated.file.file_id = 'legacy_file_old'; const batch = buildBatch(migrated);
  const record = { id: 'old', name: 'old.pdf', mime: 'application/pdf', size: 3, createdAt: 0, pageCount: 1, envelope: { schema_version: '1.0', document_id: 'old', document_type: 'other', status: 'ready', extraction: {}, evidence: {}, model: null, audit: [], validation: { schema_valid: true, totals_match: null, missing_required: [], low_confidence: [], standards_issues: [], needs_review: false } } };
  await putBatch(batch); await putFile('old', new Blob(['legacy'])); await putFile('legacy_file_old', new Blob(['migrated']));
  // IndexedDB exposes event completion, and this repository targets ES2022.
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('idp-studio');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('documents', 'readwrite');
      tx.objectStore('documents').put(record); tx.objectStore('documents').put({ ...record, id: 'unrelated' });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
  await deleteLocalBatch(batch);
  expect(await getBatch('legacy_old')).toBeUndefined();
  expect(await getFile('old')).toBeUndefined(); expect(await getFile('legacy_file_old')).toBeUndefined();
  expect((await listDocuments()).map(d => d.id)).toEqual(['unrelated']);
});
