import { useEffect, useRef, useState } from 'react';
import type { Batch, DocumentType, Page } from '../../contract/types';
import { assignPage, confirmBoundary, mergeDocuments, setDocumentType, splitDocument } from '../../contract/layout';
import type { Settings } from '../../lib/settings';
import { getFileByFileId, putBatch } from '../../lib/db';
import { createPageSource, releasePageImages } from '../../lib/agent/pageSource';
import { Badge, Button, Card, Checkbox, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select, Spinner } from '../../ds';
import { readable, workspaceHref } from '../nav';
import { REQUIRED_FIELDS } from '../../lib/standards';
import { blockingIssues } from '../../contract/rules';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
const pageKey = (p: Pick<Page, 'file_id' | 'page_number'>) => `${p.file_id}:${p.page_number}`;
type Action = 'Confirm boundary' | 'Change type' | 'Assign pages to…' | 'Split here' | 'Merge selected' | 'Mark blank';
const actions: Action[] = ['Confirm boundary', 'Change type', 'Assign pages to…', 'Split here', 'Merge selected', 'Mark blank'];
const hasLayoutIssues = (b: Batch) => b.issues.some(i => i.status === 'open' && (i.scope === 'page' || ['BOUNDARY_UNCERTAIN', 'PAGES_FAILED', 'PAGE_LIMIT_EXCEEDED'].includes(i.rule_code)));

const ownerTones = ['info', 'success', 'warning', 'danger'] as const;
function pageRanges(pages: Pick<Page, 'file_id' | 'page_number'>[]): string {
  const files = new Map<string, number[]>();
  for (const p of pages) files.set(p.file_id, [...(files.get(p.file_id) ?? []), p.page_number]);
  return [...files].map(([file, numbers]) => {
    const sorted = [...new Set(numbers)].sort((a, b) => a - b), ranges: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i];
      while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
      ranges.push(start === sorted[i] ? String(start) : `${start}–${sorted[i]}`);
    }
    return `${file}: ${ranges.join(', ')}`;
  }).join('; ');
}
/** Only visible cards own a source or rendered image; late renders are released on exit. */
function PageThumbnail({ page, originalId, maxPages }: { page: Page; originalId: string | null; maxPages: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false), [image, setImage] = useState('');
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setImage('');
    if (!visible || !originalId) return;
    let cancelled = false;
    void (async () => {
      const blob = await getFileByFileId(originalId);
      if (!blob || cancelled) return;
      const source = await createPageSource(blob, { maxPages });
      if (cancelled) { await source.dispose(); return; }
      try {
        const rendered = await source.render(page.page_number, { maxSide: 240, scale: 0.5 });
        if (!cancelled) setImage(`data:${rendered.mimeType};base64,${rendered.data}`);
        await releasePageImages(source, [rendered]);
      } finally { await source.dispose(); }
    })().catch(() => { if (!cancelled) setImage(''); });
    return () => { cancelled = true; setImage(''); };
  }, [visible, originalId, maxPages, page.page_number]);
  return <div ref={ref} className="label-thumbnail">{image ? <img src={image} alt={`Original page ${page.page_number}`} /> : <span>Page {page.page_number}</span>}</div>;
}

export function LabelStudio({ docs, loading, refresh }: StudioPageProps) {
  const sorted = [...docs].sort((a, b) => b.batch.created_at.localeCompare(a.batch.created_at));
  const [batchId, setBatchId] = useState('');
  const batch = docs.find(b => b.batch.batch_id === batchId) ?? sorted.find(hasLayoutIssues) ?? sorted[0];
  const [documentIds, setDocumentIds] = useState<string[]>([]), [pageIds, setPageIds] = useState<string[]>([]);
  const [action, setAction] = useState<Action | null>(null), [reason, setReason] = useState('');
  const [type, setType] = useState<DocumentType>('purchase_invoice'), [destination, setDestination] = useState('');
  const [error, setError] = useState(''), [summary, setSummary] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { setDocumentIds([]); setPageIds([]); setAction(null); setSummary(''); }, [batch?.batch.batch_id]);
  const locked = (id: string) => batch?.transactions.some(t => t.document_id === id && t.status === 'approved') ?? false;
  const selectedPages = batch?.pages.filter(p => pageIds.includes(pageKey(p))) ?? [];
  const involved = new Set([...documentIds, ...selectedPages.flatMap(p => p.regions.map(r => r.document_id))]);
  const readOnly = [...involved].some(locked);
  function toggle(value: string, selected: string[], set: (next: string[]) => void) { set(selected.includes(value) ? selected.filter(i => i !== value) : [...selected, value]); }
  function available(a: Action) {
    if (busy || readOnly || !batch) return false;
    if (a === 'Merge selected') return documentIds.length >= 2;
    if (a === 'Assign pages to…' || a === 'Mark blank') return selectedPages.length > 0;
    if (a === 'Split here') return documentIds.length === 1 && selectedPages.length === 1;
    if (a === 'Confirm boundary') return documentIds.length > 0 && documentIds.every(id => batch.documents.find(d => d.document_id === id)?.boundary_status === 'needs_review');
    return documentIds.length > 0;
  }
  function preview(): Batch {
    if (!batch || !action) throw new Error('Select a batch and action');
    if (action === 'Merge selected') return mergeDocuments(batch, documentIds, reason);
    if (action === 'Split here') return splitDocument(batch, documentIds[0], selectedPages[0], reason);
    if (action === 'Assign pages to…' || action === 'Mark blank') {
      if (action !== 'Mark blank' && !destination) throw new Error('Choose a destination document');
      return selectedPages.reduce((b, p) => assignPage(b, p, action === 'Mark blank' ? null : destination, reason), batch);
    }
    return documentIds.reduce((b, id) => action === 'Confirm boundary' ? confirmBoundary(b, id, reason) : setDocumentType(b, id, type, reason), batch);
  }
  async function save() {
    setError(''); setBusy(true);
    try {
      const next = preview();
      await putBatch(next);
      setBatchId(batch!.batch.batch_id);
      await refresh();
      setSummary(`${action}: ${next.documents.length} documents, ${next.pages.length} pages; ${next.reviews.length - batch!.reviews.length} reviews appended. Coverage valid.`);
      setAction(null); setDocumentIds([]); setPageIds([]);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <section className="ds-sheet label-studio">
    <PageHeader title="Label Studio" breadcrumb={<><a href="#/">Home</a> / Label Studio</>} description="Review document boundaries and page assignments. Bounding boxes are read-only evidence." />
    {loading ? <Spinner /> : !batch ? <EmptyState title="No batches" description="Upload a document to review its structure." /> : <>
      <Field label="Batch"><Select value={batch.batch.batch_id} onChange={e => { setBatchId(e.target.value); setError(''); }}>
        {sorted.map(b => <option key={b.batch.batch_id} value={b.batch.batch_id}>{b.source_files.map(f => f.filename).join(', ')} · {b.batch.created_at}</option>)}
      </Select></Field>
      {summary && <Notice>{summary}</Notice>}
      {readOnly && <Notice tone="warning">Documents with approved transactions are read-only. Select only unapproved documents and pages to make changes.</Notice>}
      <div className="ds-row" role="toolbar" aria-label="Layout actions">{actions.map(a => <Button key={a} disabled={!available(a)} onClick={() => { setAction(a); setReason(''); setError(''); setDestination(''); }}>{a}</Button>)}</div>
      <div className="label-layout"><aside aria-label="Documents" className="label-documents">{batch.documents.map((doc, index) => <Card key={doc.document_id}>
        <Checkbox label={`Document ${index + 1}: ${readable(doc.document_type)}`} checked={documentIds.includes(doc.document_id)} onChange={() => toggle(doc.document_id, documentIds, setDocumentIds)} />
        <p>{doc.document_id}</p><Badge tone={ownerTones[index % ownerTones.length]}>Document {index + 1}</Badge><p>Pages {pageRanges(doc.page_refs)}</p>
        <Badge tone={doc.boundary_status === 'confirmed' ? 'success' : 'warning'}>{readable(doc.boundary_status)}</Badge>
        <p>{doc.transaction_ids.length} transactions · {new Set(batch.transactions.filter(t => t.document_id === doc.document_id).flatMap(t => blockingIssues(batch, t).map(i => i.issue_id))).size} open blocking issues</p>
        {locked(doc.document_id) && <p>Read-only: approved transactions</p>}
        <a href={workspaceHref(batch, doc.transaction_ids[0])}>Open Document {index + 1} in Workspace</a>
      </Card>)}</aside>
      <div className="label-pages" aria-label="Pages">{batch.pages.map(page => {
        const owners = batch.documents.filter(d => d.page_refs.some(p => pageKey(p) === pageKey(page)));
        const file = batch.source_files.find(f => f.file_id === page.file_id);
        const issues = batch.issues.filter(i => i.status === 'open' && (i.target_id === pageKey(page) || owners.some(d => d.document_id === i.target_id) || (page.status === 'error' && i.rule_code === 'PAGES_FAILED') || (page.status === 'pending' && i.rule_code === 'PAGE_LIMIT_EXCEEDED')));
        return <Card key={pageKey(page)}>
          <Checkbox label={`Select page ${page.page_number} (${page.file_id})`} checked={pageIds.includes(pageKey(page))} onChange={() => toggle(pageKey(page), pageIds, setPageIds)} />
          <PageThumbnail page={page} originalId={file?.storage_ref ?? null} maxPages={file?.page_count ?? 1} />
          <Badge>{readable(page.status)}{page.unassigned_reason ? ` · ${readable(page.unassigned_reason)}` : ''}</Badge>
          <div className="ds-row">{owners.length ? owners.map(d => <Badge key={d.document_id} tone={ownerTones[batch.documents.indexOf(d) % ownerTones.length]}>Document {batch.documents.indexOf(d) + 1} · {d.document_id}</Badge>) : <Badge>Unassigned</Badge>}</div>
          {issues.map(i => <Badge key={i.issue_id} tone="warning">{i.rule_code}</Badge>)}
        </Card>;
      })}</div></div>
    </>}
    <Dialog open={action !== null} title={action ?? 'Layout review'} onClose={() => { if (!busy) setAction(null); }}>
      <p>{documentIds.length} documents and {pageIds.length} pages selected. Changes preserve coverage and append audit reviews.</p>
      {batch && <p>Result if accepted: {batch.documents.length + (action === 'Split here' ? 1 : action === 'Merge selected' ? 1 - documentIds.length : 0)} documents; all {batch.pages.length} pages retained. {action === 'Confirm boundary' ? 'Selected boundaries become confirmed.' : action === 'Change type' ? `Selected documents use ${readable(type)} rules.` : 'Affected document boundaries require review.'}</p>}
      {action === 'Change type' && <Field label="Document type"><Select value={type} onChange={e => setType(e.target.value as DocumentType)}>{Object.keys(REQUIRED_FIELDS).map(t => <option key={t} value={t}>{readable(t)}</option>)}</Select></Field>}
      {action === 'Assign pages to…' && <Field label="Destination document"><Select value={destination} onChange={e => setDestination(e.target.value)}><option value="">Choose a document</option>{batch?.documents.filter(d => !locked(d.document_id)).map(d => <option key={d.document_id} value={d.document_id}>{d.document_id} · {readable(d.document_type)}</option>)}</Select></Field>}
      {action === 'Split here' && <p>The selected page and later pages become a new document with an empty transaction requiring data review.</p>}
      {action === 'Mark blank' && <p>Selected pages become explicitly blank and unassigned. Pages referenced by evidence cannot be moved.</p>}
      <Field label="Reason" hint="Required audit reason"><Input required value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <Button disabled={busy || !reason.trim()} onClick={() => void save()}>{busy ? 'Saving…' : 'Apply review'}</Button>
    </Dialog>
  </section>;
}
