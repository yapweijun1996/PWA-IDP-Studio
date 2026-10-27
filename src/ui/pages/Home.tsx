import { useState } from 'react';
import { loadMode, loadProfiles, saveMode } from '../../lib/profiles';
import type { AgentStep, ExtractionProfile } from '../../lib/agent/contract';
import { Field, Segmented, Select } from '../../ds';
import type { Batch } from '../../contract/types';
import { batchSummary } from '../../contract/view';
import type { Settings } from '../../lib/settings';
import { providerInfo } from '../../lib/providers';
import { Button, Card, Dropzone, Notice, PageHeader, Progress, StatCard } from '../../ds';
import { BatchTable } from '../BatchTable';
export function Home({ docs, settings, busy, onFiles, steps = [], search = '', loading, onDeleted, onRetry, offlineUpload = false }: { steps?: AgentStep[]; onRetry?: (batchId: string) => void; docs: Batch[]; settings: Settings; busy: string | null; onFiles: (files: File[], profile?: ExtractionProfile) => void; search?: string; loading?: boolean; onDeleted?: () => void | Promise<void>; offlineUpload?: boolean }) {
  const [mode, setMode] = useState(loadMode);
  const profiles = loadProfiles();
  const profile = mode.kind === 'targeted' ? profiles.find(p => p.id === mode.profileId) : undefined;
  const summary = batchSummary(docs);
  return <section className="ds-sheet">
    <PageHeader breadcrumb="Home" title="Upload Documents" description="Upload PDF, PNG or JPG files to extract and structure your documents using AI." />
    {offlineUpload && <Notice tone="warning">You are offline. Uploads need a connection to the AI provider, so nothing was stored or sent. Your saved documents are still available.</Notice>}
    <Segmented label="Extraction mode" value={mode.kind} onChange={kind => { const next = kind === 'targeted' ? { kind: 'targeted' as const, profileId: profiles[0].id } : { kind: 'auto' as const }; setMode(next); saveMode(next); }} options={[{ value: 'auto', label: 'Auto (AI decides)' }, { value: 'targeted', label: 'Targeted fields' }]} />
    {profile && <Card><Field label="Extraction profile"><Select value={profile.id} onChange={e => { const next = { kind: 'targeted' as const, profileId: e.target.value }; setMode(next); saveMode(next); }}>{profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field><p>{profile.fields.map(f => f.label).join(', ')}{profile.rowFields.length ? ` + ${profile.rowFields.length} row columns` : ''}</p><a href="#/settings">Edit profiles</a></Card>}
    <Dropzone multiple accept="application/pdf,image/png,image/jpeg,.pdf,.png,.jpg,.jpeg" label="Drag and drop documents here" hint={`Supports PDF, PNG, JPG. Up to ${settings.maxPages} pages per file are processed. Files with more than 10 pages are split into documents automatically. You can upload multiple files at once. TIFF and WebP are not supported.`} onFiles={files => onFiles(files, profile)} />
    <p>Pages are sent to <strong>{providerInfo(settings.provider).recipient}</strong>. <a href="#/settings">Change provider</a></p>
    {busy && <Notice><Progress label={busy} /></Notice>}
    {busy && <ul role="status" aria-live="polite" aria-label="Agent activity">{steps.map((step, i) => <li key={i}>{step.summary}</li>)}</ul>}
    {docs.filter(b => b.pages.some(p => p.status !== 'classified') || b.batch.status === 'failed').map(b => <Card key={b.batch.batch_id}><h2>{b.source_files[0].filename}</h2><Progress label={`Page coverage ${b.pages.filter(p => p.status === 'classified').length}/${b.pages.length} · ${b.batch.status === 'processing' ? busy ?? 'Processing interrupted.' : b.batch.status.replaceAll('_', ' ')}`} value={b.pages.filter(p => p.status === 'classified').length} max={b.pages.length} /><Notice tone="warning">Unprocessed pages: {b.pages.filter(p => p.status !== 'classified').map(p => `${p.page_number} (${p.status === 'error' ? 'failed' : 'not processed'})`).join(', ')}. Unprocessed pages block export. {b.issues.find(i => i.rule_code === 'EXTRACTION_FAILED')?.message}</Notice>{b.batch.status === 'failed' && onRetry && <Button disabled={!!busy} onClick={() => onRetry(b.batch.batch_id)}>Retry extraction</Button>}</Card>)}
    <div className="ds-grid ds-stat-grid"><StatCard icon="document" label="Pages processed" value={summary.pages} caption="Physical pages in uploaded batches" /><StatCard icon="collection" label="Documents detected" value={summary.documents} /><StatCard icon="ledger" label="Transactions extracted" value={summary.transactions} /></div>
    <Card><div className="ds-row"><h2>Recent uploads</h2><a href="#/documents">View all</a></div><BatchTable docs={docs} search={search} recent loading={loading} onDeleted={onDeleted} /></Card>
  </section>;
}
