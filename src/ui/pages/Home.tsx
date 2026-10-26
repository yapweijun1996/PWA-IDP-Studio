import type { Batch } from '../../contract/types';
import { batchSummary } from '../../contract/view';
import type { Settings } from '../../lib/settings';
import { providerInfo } from '../../lib/providers';
import { Button, Card, Dropzone, Notice, PageHeader, Progress, StatCard } from '../../ds';
import { BatchTable } from '../BatchTable';
export function Home({ docs, settings, busy, onFiles, search = '', loading, onDeleted, onRetry, offlineUpload = false }: { onRetry?: (batchId: string) => void; docs: Batch[]; settings: Settings; busy: string | null; onFiles: (files: File[]) => void; search?: string; loading?: boolean; onDeleted?: () => void | Promise<void>; offlineUpload?: boolean }) {
  const summary = batchSummary(docs);
  return <section className="ds-sheet">
    <PageHeader breadcrumb="Home" title="Upload Documents" description="Upload PDF, PNG or JPG files to extract and structure your documents using AI." />
    {offlineUpload && <Notice tone="warning">You are offline. Uploads need a connection to the AI provider, so nothing was stored or sent. Your saved documents are still available.</Notice>}
    <Dropzone multiple accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" label="Drag and drop documents here" hint={`Supports PDF, PNG, JPG. Up to ${settings.maxPages} pages per file are processed. You can upload multiple files at once. TIFF and WebP are not supported.`} onFiles={onFiles} />
    <p>Pages are sent to <strong>{providerInfo(settings.provider).recipient}</strong>. <a href="#/settings">Change provider</a></p>
    {busy && <Notice><Progress label={busy} /></Notice>}
    {docs.filter(b => b.pages.some(p => p.status !== 'classified') || b.batch.status === 'failed').map(b => <Card key={b.batch.batch_id}><h2>{b.source_files[0].filename}</h2><Progress label={`Page coverage ${b.pages.filter(p => p.status === 'classified').length}/${b.pages.length} · ${b.batch.status === 'processing' ? busy ?? 'Processing interrupted.' : b.batch.status.replaceAll('_', ' ')}`} value={b.pages.filter(p => p.status === 'classified').length} max={b.pages.length} /><Notice tone="warning">Unprocessed pages: {b.pages.filter(p => p.status !== 'classified').map(p => `${p.page_number} (${p.status === 'error' ? 'failed' : 'not processed'})`).join(', ')}. Unprocessed pages block export. {b.issues.find(i => i.rule_code === 'EXTRACTION_FAILED')?.message}</Notice>{b.batch.status === 'failed' && onRetry && <Button disabled={!!busy} onClick={() => onRetry(b.batch.batch_id)}>Retry extraction</Button>}</Card>)}
    <div className="ds-grid ds-stat-grid"><StatCard icon="document" label="Pages processed" value={summary.pages} caption="Physical pages in uploaded batches" /><StatCard icon="collection" label="Documents detected" value={summary.documents} /><StatCard icon="ledger" label="Transactions extracted" value={summary.transactions} /></div>
    <Card><div className="ds-row"><h2>Recent uploads</h2><a href="#/documents">View all</a></div><BatchTable docs={docs} search={search} recent loading={loading} onDeleted={onDeleted} /></Card>
  </section>;
}
