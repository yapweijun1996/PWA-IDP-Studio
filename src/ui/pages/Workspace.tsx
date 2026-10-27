import { loadBatchMode } from '../../lib/profiles';
import type { AgentStep } from '../../lib/agent/contract';
import { useEffect, useState } from 'react';
import { getFileByFileId, putBatch } from '../../lib/db';
import { renderFile, type RenderedPage } from '../../lib/pdf';
import type { Batch } from '../../contract/types';
import { transactionView } from '../../contract/view';
import { approveTransaction, correctField } from '../../contract/review';
import { exportEligibleTransactions, validateBatch } from '../../contract/validate';
import { Button, Card, DataTable, EvidenceViewer, Field, Input, Menu, Notice, PageHeader, Progress, Segmented, Select, StatusPill, Tabs } from '../../ds';
import { readable } from '../nav';
import { issueTitle } from '../issues';
export function downloadJSON(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
export function Workspace({ doc, onSaved, transactionId, busy, onRetry, steps = [] }: { steps?: AgentStep[]; busy?: string | null; onRetry?: () => void; doc: Batch; onSaved: (d: Batch) => void; transactionId?: string }) {
  const profile = loadBatchMode(doc.batch.batch_id)?.profile;
  const label = (key: string) => [...(profile?.fields ?? []), ...(profile?.rowFields ?? [])].find(f => f.key === key)?.label ?? readable(key);
  const [txId, setTxId] = useState(transactionId ?? doc.transactions[0]?.transaction_id);
  const tx = doc.transactions.find(t => t.transaction_id === txId) ?? doc.transactions[0];
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [tab, setTab] = useState('fields');
  const [full, setFull] = useState('clean');
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('Manual correction');
  const [copied, setCopied] = useState(false);
  const file = doc.source_files[0];
  const previewLimit = doc.pages.reduce((max, p) => p.file_id === file.file_id && p.status === 'classified' ? Math.max(max, p.page_number) : max, 0);
  useEffect(() => { setTxId(transactionId ?? doc.transactions[0]?.transaction_id); setSelected(undefined); setEditing(undefined); }, [transactionId, doc.batch.batch_id]);
  useEffect(() => {
    let live = true;
    setPages([]); setRenderError('');
    getFileByFileId(file.file_id).then(blob => {
      if (!blob) throw new Error('Original file is missing from this browser.');
      return previewLimit ? renderFile(blob, { maxPages: previewLimit }) : [];
    }).then(result => { if (live) setPages(result); }).catch(e => { if (live) setRenderError(String(e.message ?? e)); });
    return () => { live = false; };
  }, [file.file_id, previewLimit]);
  if (!tx) {
    const failure = doc.issues.find(i => i.rule_code === 'EXTRACTION_FAILED');
    const working = doc.batch.status === 'processing' && !!busy;
    return <section className="ds-sheet"><PageHeader title={file.filename} breadcrumb={<a href="#/documents">Documents</a>} />
      {working ? <Notice tone="info">{busy}</Notice>
        : failure ? <Notice tone="error">Extraction failed. {failure.message}</Notice>
        : <Notice tone="warning">{doc.batch.status === 'processing' ? 'Processing was interrupted before it produced a transaction.' : 'No extracted transactions.'}</Notice>}
      {working && <ul role="status" aria-live="polite" aria-label="Agent activity">{steps.map((step, i) => <li key={i}>{step.summary}</li>)}</ul>}
      {!working && onRetry && <Button variant="primary" onClick={onRetry}>Retry extraction</Button>}
    </section>;
  }
  const view = transactionView(doc, tx.transaction_id);
  const eligible = validateBatch(doc).ok && exportEligibleTransactions(doc).includes(tx.transaction_id);
  const clean = JSON.stringify(profile ? tx.data : { document_type: view.documentType, ...tx.data }, null, 2);
  const evidence = JSON.stringify(doc, null, 2);
  const json = full === 'full' ? evidence : clean;
  const base = file.filename.replace(/\.[^.]+$/, '');
  const save = async (next: Batch) => { setSaving(true); setError(''); try { await putBatch(next); onSaved(next); setEditing(undefined); } catch(e) { setError(String(e)); } finally { setSaving(false); } };
  const approve = async () => { const result = approveTransaction(doc, tx.transaction_id, 'Reviewed and approved in workspace'); if (result.ok) await save(result.batch); else setError(result.error); };
  const copy = async () => { try { await navigator.clipboard.writeText(json); setCopied(true); } catch(e) { setError(`Copy failed: ${String(e)}`); } };
  const selectedField = view.fields.find(f => f.pointer === selected);
  const fieldContent = <div className="ds-sheet">
    {view.fields.filter(field => !profile || Object.hasOwn(tx.data, field.key) || field.exception === 'missing').map(field => <Card key={field.pointer}><div className="ds-row"><Button aria-pressed={selected === field.pointer} onClick={() => { setSelected(field.pointer); if (field.evidence) setPage(field.evidence.page); }}>{label(field.key)}</Button>{field.exception && <StatusPill tone="warning" icon="alert">{readable(field.exception)}</StatusPill>}</div>
      <p>{typeof field.value === 'object' && field.value !== null ? JSON.stringify(field.value) : String(field.value ?? '') || 'Missing value'}</p>
      {field.confidence === null ? <p className="ds-muted">Confidence unavailable</p> : <><span>Confidence {Math.round(field.confidence * 100)}%</span><Progress label={`${readable(field.key)} confidence`} value={field.confidence * 100} max={100} /></>}
      {editing === field.pointer ? <form onSubmit={e => { e.preventDefault(); if (!reason.trim()) return; try { void save(correctField(doc, tx.transaction_id, field.pointer, draft, reason.trim())); } catch(err) { setError(String(err)); } }}><Field label={`Edit ${field.key}`}><Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} /></Field><Field label="Correction reason"><Input required value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={saving || !reason.trim()}>Save correction</Button><Button disabled={saving} onClick={() => setEditing(undefined)}>Cancel</Button></form> : <Button disabled={saving} onClick={() => { setEditing(field.pointer); setDraft(String(field.value ?? '')); setReason('Manual correction'); }}>Edit {readable(field.key)}</Button>}
    </Card>)}
    <DataTable caption="Line items" rows={view.lineItems.map((item, index) => ({ item, index }))} rowKey={r => String(r.index)} columns={[...new Set(view.lineItems.flatMap(item => Object.keys(item)))].map(key => ({ key, label: label(key), render: (r: { item: Record<string, unknown>; index: number }) => {
      const pointer = `/line_items/${r.index}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      return editing === pointer ? <form onSubmit={e => { e.preventDefault(); if (reason.trim()) { try { void save(correctField(doc, tx.transaction_id, pointer, draft, reason.trim())); } catch (err) { setError(String(err)); } } }}><Field label={`Edit ${label(key)}`}><Input value={draft} onChange={e => setDraft(e.target.value)} /></Field><Field label="Correction reason"><Input required value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={saving || !reason.trim()}>Save correction</Button><Button onClick={() => setEditing(undefined)}>Cancel</Button></form> : <Button aria-label={`Edit ${label(key)} row ${r.index + 1}`} onClick={() => { setEditing(pointer); setDraft(String(r.item[key] ?? '')); setReason('Manual correction'); }}>{String(r.item[key] ?? '') || 'Missing value'}</Button>;
    } }))} emptyMessage="No line items" />
  </div>;
  return <section className="ds-sheet">
    <PageHeader breadcrumb={<><a href="#/">Home</a> / <a href="#/documents">Documents</a> / Workspace</>} title={file.filename} description={`${readable(view.documentType)} · ${doc.pages.length} pages`} actions={<div className="ds-row"><StatusPill>{readable(tx.status)}</StatusPill><Button variant="primary" disabled={!view.canApprove || saving} aria-describedby="approval-reason" onClick={() => void approve()}>Approve</Button><Menu label="Export" items={[{ label: 'Clean JSON', disabled: !eligible, onSelect: () => downloadJSON(`${base}.json`, clean) }, { label: 'Full evidence JSON', disabled: !eligible, onSelect: () => downloadJSON(`${base}.evidence.json`, evidence) }]} /><Button disabled={!eligible} onClick={() => void copy()}>Copy</Button></div>} />
    {(!view.canApprove || !eligible) && <Notice tone="warning"><span id="approval-reason">{view.blockingCount} blockers. {tx.status === 'approved' ? 'This transaction is already approved.' : view.blockingCount ? 'Resolve blocking issues before approval, copying or exporting.' : 'Confirm document boundaries and resolve validation errors before approval or export.'} <a href="#workspace-issues" onClick={event => { event.preventDefault(); setTab('issues'); }}>Review issues</a></span></Notice>}
    {busy && <Notice><Progress label={busy} /><ul role="status" aria-live="polite" aria-label="Agent activity">{steps.map((step, i) => <li key={i}>{step.summary}</li>)}</ul></Notice>}
    {!busy && onRetry && doc.pages.some(p => p.status !== 'classified') && <Button onClick={onRetry}>Retry extraction</Button>}
    {error && <Notice tone="error">{error}</Notice>}{copied && <Notice>JSON copied.</Notice>}
    {doc.transactions.length > 1 && <Field label="Transaction"><Select value={tx.transaction_id} onChange={e => { setTxId(e.target.value); setSelected(undefined); setEditing(undefined); }}>{doc.transactions.map(t => <option key={t.transaction_id} value={t.transaction_id}>{t.transaction_id} · {readable(t.transaction_type)}</option>)}</Select></Field>}
    <div className="ds-grid"><Card><EvidenceViewer pages={doc.pages.filter(p => p.file_id === file.file_id).map(p => { const rendered = pages.find(r => r.page === p.page_number); return { number: p.page_number, pending: p.status !== 'classified', src: rendered ? `data:${rendered.mimeType};base64,${rendered.data}` : undefined }; })} page={page} onPageChange={setPage} selected={selectedField?.pointer} error={renderError} boxes={view.fields.filter(f => f.evidence?.page === page).map(f => ({ id: f.pointer, label: readable(f.key), ...f.evidence!.bbox }))} /></Card>
    <Card><div id="workspace-issues"><Tabs label="Transaction details" value={tab} onChange={setTab} items={[
      { id: 'fields', label: 'Fields', content: fieldContent },
      { id: 'issues', label: `Issues (${view.issues.filter(i => i.status === 'open').length})`, content: <div className="ds-sheet">{view.issues.length ? view.issues.map(i => <Card key={i.issue_id}><h2>{issueTitle(i.rule_code)}</h2><StatusPill tone={['blocking','error'].includes(i.severity) ? 'danger' : i.severity === 'info' ? 'info' : 'warning'} icon={i.severity === 'info' ? 'info' : 'alert'}>{readable(i.severity)}</StatusPill><p>{i.message}</p><p>Target: {i.scope} · {i.target_id} · {readable(i.status)}</p><small className="ds-muted">{i.rule_code}</small></Card>) : <p>No issues found.</p>}</div> },
      { id: 'json', label: 'JSON', content: <div className="ds-sheet"><Segmented label="JSON format" value={full} onChange={v => { setFull(v); setCopied(false); }} options={[{ value: 'clean', label: 'Clean' }, { value: 'full', label: 'Full evidence' }]} /><div className="ds-row"><Button disabled={!eligible} onClick={() => void copy()}>Copy JSON</Button><Button disabled={!eligible} onClick={() => downloadJSON(`${base}${full === 'full' ? '.evidence' : ''}.json`, json)}>Download JSON</Button></div><pre className="ds-json">{json}</pre></div> },
    ]} /></div></Card></div>
  </section>;
}
