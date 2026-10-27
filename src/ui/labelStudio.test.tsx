import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import type { Batch } from '../contract/types';
import { recomputeIssues } from '../contract/review';
import { validateBatch } from '../contract/validate';
import { LabelStudio } from './pages/LabelStudio';
import { loadSettings } from '../lib/settings';
import { getFileByFileId, putBatch } from '../lib/db';
import { createPageSource } from '../lib/agent/pageSource';
vi.mock('../lib/db', () => ({ getFileByFileId: vi.fn(async () => undefined), putBatch: vi.fn(async () => undefined) }));
vi.mock('../lib/agent/pageSource', () => ({ createPageSource: vi.fn(), releasePageImages: vi.fn(async (_source, pages) => { for (const p of pages) p.data = ''; }) }));
let root: Root, container: HTMLDivElement;
let observations: { element: Element; emit: (visible: boolean) => void }[];
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  observations = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: { isIntersecting: boolean }[]) => void) {}
    observe(element: Element) { observations.push({ element, emit: visible => this.callback([{ isIntersecting: visible }]) }); }
    disconnect() {}
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render(node: ReactNode) { await act(async () => root.render(node)); }
async function click(element: Element) { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); }
const button = (label: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent === label)!;
async function reason(value: string) {
  await act(async () => {
    const element = document.querySelector('[role="dialog"] input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function fixture(): Batch {
  const input = invoiceInput();
  input.pages = [1, 2, 3, 4].map(page_number => ({ page_number, width: 595, height: 842 })); input.renderedPageCount = 3;
  const b = buildBatch(input); b.documents[0].boundary_status = 'needs_review';
  return recomputeIssues(b);
}
it('requires a reason, confirms a boundary and refreshes persisted state', async () => {
  const original = fixture();
  const refresh = vi.fn(async () => undefined);
  await render(<LabelStudio docs={[original]} settings={loadSettings()} refresh={refresh} />);
  await click(container.querySelector('[aria-label="Documents"] input')!);
  await click(button('Confirm boundary'));
  expect(button('Apply review').disabled).toBe(true);
  await reason('Reviewed original page order');
  await click(button('Apply review'));
  const saved = vi.mocked(putBatch).mock.calls[0][0];
  expect(saved.documents[0].boundary_status).toBe('confirmed');
  expect(saved.reviews.at(-1)).toMatchObject({ action: 'confirm', reason: 'Reviewed original page order' });
  expect(saved.issues.some(i => i.rule_code === 'BOUNDARY_UNCERTAIN' && i.status === 'open')).toBe(false);
  expect(refresh).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Coverage valid');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('selects the newest layout-issue batch rather than the newest clean batch', async () => {
  const old = fixture(); old.batch.batch_id = 'old'; old.batch.created_at = '2025-01-01T00:00:00Z';
  const newest = buildBatch(invoiceInput()); newest.batch.batch_id = 'new'; newest.batch.created_at = '2026-01-01T00:00:00Z';
  await render(<LabelStudio docs={[newest, old]} settings={loadSettings()} refresh={async () => {}} />);
  expect(container.querySelector('select')!.value).toBe('old');
});
it('keeps approved documents read-only and shows persistence failures without losing the reason', async () => {
  const b = fixture(); b.transactions[0].status = 'approved';
  await render(<LabelStudio docs={[b]} settings={loadSettings()} refresh={async () => {}} />);
  await click(container.querySelector('[aria-label="Documents"] input')!);
  expect(button('Confirm boundary').disabled).toBe(true);
  expect(container.textContent).toContain('approved transactions are read-only');
  const editable = fixture();
  await render(<LabelStudio docs={[editable]} settings={loadSettings()} refresh={async () => {}} />);
  await click(button('Confirm boundary'));
  await reason('Original checked');
  vi.mocked(putBatch).mockRejectedValueOnce(new Error('Storage unavailable'));
  await click(button('Apply review'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('Storage unavailable');
  expect((document.querySelector('[role="dialog"] input') as HTMLInputElement).value).toBe('Original checked');
});
it('splits then merges and assigns a pending page through the actual dialogs', async () => {
  let current = fixture();
  function Page() {
    const [b, setBatch] = useState(current);
    return <LabelStudio docs={[b]} settings={loadSettings()} refresh={async () => {
      current = vi.mocked(putBatch).mock.calls.at(-1)![0]; setBatch(current);
    }} />;
  }
  await render(<Page />);
  await click(container.querySelector('[aria-label="Documents"] input')!);
  await click(container.querySelectorAll('[aria-label="Pages"] input')[1]);
  await click(button('Split here')); await reason('Separate pages'); await click(button('Apply review'));
  expect(current.documents).toHaveLength(2);
  const empty = current.transactions.find(t => !Object.keys(t.data).length)!;
  expect(empty.status).toBe('review_required');
  for (const input of container.querySelectorAll('[aria-label="Documents"] input')) await click(input);
  await click(button('Merge selected')); await reason('Same original'); await click(button('Apply review'));
  expect(current.documents).toHaveLength(1);
  await click(container.querySelectorAll('[aria-label="Pages"] input')[3]);
  await click(button('Assign pages to…'));
  await act(async () => {
    const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
    select.value = current.documents[0].document_id; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await reason('Page belongs here'); await click(button('Apply review'));
  expect(current.pages[3].status).toBe('classified');
  expect(current.pages[3].regions[0].document_id).toBe(current.documents[0].document_id);
  expect(current.reviews.map(r => r.action)).toEqual(['split', 'merge', 'assign']);
  expect(validateBatch(current).ok).toBe(true);
});
it('loads only intersecting thumbnails and drops off-screen images', async () => {
  const b = fixture();
  vi.mocked(getFileByFileId).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  const dispose = vi.fn(async () => undefined);
  const renderPage = vi.fn(async () => ({ page: 1, width: 100, height: 100, data: 'AA==', mimeType: 'image/jpeg' as const }));
  vi.mocked(createPageSource).mockResolvedValue({ pageCount: 4, render: renderPage, textItems: async () => [], dispose });
  await render(<LabelStudio docs={[b]} settings={loadSettings()} refresh={async () => {}} />);
  expect(container.querySelector('img')).toBeNull();
  await act(async () => observations[0].emit(true));
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AA==');
  expect(dispose).toHaveBeenCalledOnce();
  await act(async () => observations[0].emit(false));
  expect(container.querySelector('img')).toBeNull();
  expect(vi.mocked(createPageSource).mock.calls).toHaveLength(1);
  vi.mocked(getFileByFileId).mockResolvedValue(undefined);
  await act(async () => observations[1].emit(true));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('Page 2');
});
it('shows loading and empty states', async () => {
  await render(<LabelStudio docs={[]} loading settings={loadSettings()} refresh={async () => {}} />);
  expect(container.querySelector('.ds-spinner')).not.toBeNull();
  await render(<LabelStudio docs={[]} settings={loadSettings()} refresh={async () => {}} />);
  expect(container.textContent).toContain('No batches');
});
it('changes type and marks an unevidenced page blank without editing evidence', async () => {
  let current = fixture();
  const originalEvidence = structuredClone(current.evidence);
  function Page() {
    const [batch, setBatch] = useState(current);
    return <LabelStudio docs={[batch]} settings={loadSettings()} refresh={async () => {
      current = vi.mocked(putBatch).mock.calls.at(-1)![0]; setBatch(current);
    }} />;
  }
  await render(<Page />);
  await click(container.querySelector('[aria-label="Documents"] input')!);
  await click(button('Change type'));
  await act(async () => {
    const select = document.querySelector('[role="dialog"] select') as HTMLSelectElement;
    select.value = 'bank_receipt'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await reason('Receipt classification'); await click(button('Apply review'));
  expect(current.documents[0].document_type).toBe('bank_receipt');
  expect(current.issues.some(i => i.rule_code === 'MISSING_REQUIRED' && i.message.includes('/receipt_no') && i.status === 'open')).toBe(true);
  await click(container.querySelectorAll('[aria-label="Pages"] input')[3]);
  await click(button('Mark blank')); await reason('Blank separator'); await click(button('Apply review'));
  expect(current.pages[3]).toMatchObject({ status: 'classified', unassigned_reason: 'blank', regions: [] });
  expect(current.evidence).toEqual(originalEvidence);
  expect(validateBatch(current).ok).toBe(true);
  await click(container.querySelectorAll('[aria-label="Pages"] input')[0]);
  await click(button('Mark blank')); await reason('Unsafe reassignment'); await click(button('Apply review'));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('evidence');
  expect(current.pages[0].regions[0].document_id).toBe(current.documents[0].document_id);
});
it('releases a late render after its card leaves the viewport', async () => {
  const b = fixture();
  vi.mocked(getFileByFileId).mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' }));
  let complete!: (value: { page: number; width: number; height: number; data: string; mimeType: 'image/jpeg' }) => void;
  const pending = new Promise<{ page: number; width: number; height: number; data: string; mimeType: 'image/jpeg' }>(resolve => { complete = resolve; });
  const dispose = vi.fn(async () => undefined);
  vi.mocked(createPageSource).mockResolvedValue({ pageCount: 4, render: () => pending, textItems: async () => [], dispose });
  await render(<LabelStudio docs={[b]} settings={loadSettings()} refresh={async () => {}} />);
  await act(async () => observations[0].emit(true));
  await act(async () => observations[0].emit(false));
  await act(async () => complete({ page: 1, width: 100, height: 100, data: 'AA==', mimeType: 'image/jpeg' }));
  expect(container.querySelector('img')).toBeNull();
  expect(dispose).toHaveBeenCalledOnce();
});
it('keeps the reviewed batch selected after its final layout issue is resolved', async () => {
  const older = buildBatch(invoiceInput());
  older.batch.batch_id = 'older';
  older.batch.created_at = '2025-01-01T00:00:00Z';
  older.documents[0].boundary_status = 'needs_review';
  const reviewable = recomputeIssues(older);
  const newer = buildBatch(invoiceInput());
  newer.batch.batch_id = 'newer';
  newer.batch.created_at = '2026-01-01T00:00:00Z';
  function Page() {
    const [docs, setDocs] = useState([newer, reviewable]);
    return <LabelStudio docs={docs} settings={loadSettings()} refresh={async () => {
      const saved = vi.mocked(putBatch).mock.calls.at(-1)![0];
      setDocs([newer, saved]);
    }} />;
  }
  await render(<Page />);
  expect(container.querySelector('select')!.value).toBe('older');
  await click(container.querySelector('[aria-label="Documents"] input')!);
  await click(button('Confirm boundary'));
  await reason('Final layout issue checked');
  await click(button('Apply review'));
  expect(container.querySelector('select')!.value).toBe('older');
  expect(container.querySelector('[aria-label="Documents"] .ds-badge.ds-tone-success')?.textContent).toBe('Confirmed');
  expect(container.textContent).toContain('Confirm boundary: 1 documents');
});
