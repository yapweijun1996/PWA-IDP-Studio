import { keyFromLabel, loadBatchMode, loadProfiles, uniqueProfileName } from '../../lib/profiles';
import { templateFromTransaction } from '../../lib/template';
import type { AgentStep, ExtractionProfile } from '../../lib/agent/contract';
import { CustomizeFields } from '../CustomizeFields';
import { AddRow, rowColumns } from '../AddRow';
import { TemplateLibraryBar } from '../TemplateLibraryBar';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { getFileByFileId, putBatch } from '../../lib/db';
import { renderFile, type RenderedPage } from '../../lib/pdf';
import type { Batch } from '../../contract/types';
import { transactionView } from '../../contract/view';
import { reconcileTotals } from '../../contract/rules';
import { addLineItemColumn, addRow, approveTransaction, correctField, handEnteredRows } from '../../contract/review';
import { exportEligibleTransactions, validateBatch } from '../../contract/validate';
import { Button, Card, DataTable, EvidenceViewer, Field, Input, Menu, Notice, PageHeader, Progress, Segmented, Select, StatusPill, Tabs } from '../../ds';
import { readable } from '../nav';
import { issueTitle } from '../issues';
import { downloadJSON, groupedJSONValue, serializeJSON, transactionJSONValue } from '../../lib/jsonExport';
import { sectionOf } from '../../lib/sections';
import { padDecimals } from '../../contract/decimal';
/** `onReextract` reads this file again with a customized template; `locked` freezes the current result while that runs. */
export function Workspace({ doc, onSaved, transactionId, busy, onRetry, onReextract, locked = false, steps = [] }: { steps?: AgentStep[]; busy?: string | null; onRetry?: () => void; onReextract?: (profile: ExtractionProfile) => void; locked?: boolean; doc: Batch; onSaved: (d: Batch) => void; transactionId?: string }) {
  const profile = loadBatchMode(doc.batch.batch_id)?.profile;
  const [customizing, setCustomizing] = useState(false);
  const [addingRow, setAddingRow] = useState(false);
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
  const [details, setDetails] = useState<string>();
  const [addingColumn, setAddingColumn] = useState(false);
  const [columnLabel, setColumnLabel] = useState('');
  const [columnError, setColumnError] = useState('');
  const [viewerWidth, setViewerWidth] = useState(50);
  const splitRef = useRef<HTMLDivElement>(null);
  const dragPointer = useRef<number | null>(null);
  const viewerId = useId();
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('Manual correction');
  const [copied, setCopied] = useState(false);
  const [transactionSearch, setTransactionSearch] = useState('');
  const file = doc.source_files[0];
  const previewLimit = doc.pages.reduce((max, p) => p.file_id === file.file_id && p.status === 'classified' ? Math.max(max, p.page_number) : max, 0);
  useEffect(() => { setTxId(transactionId ?? doc.transactions[0]?.transaction_id); setSelected(undefined); setEditing(undefined); setDetails(undefined); setAddingColumn(false); }, [transactionId, doc.batch.batch_id]);
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
  const clean = serializeJSON(transactionJSONValue(doc, tx.transaction_id));
  const evidence = serializeJSON(doc);
  const grouped = serializeJSON(groupedJSONValue(doc, tx.transaction_id));
  const json = full === 'full' ? evidence : full === 'grouped' ? grouped : clean;
  const base = file.filename.replace(/\.[^.]+$/, '');
  const save = async (next: Batch) => { if (locked) return false; setSaving(true); setError(''); try { await putBatch(next); onSaved(next); setEditing(undefined); return true; } catch(e) { setError(String(e)); return false; } finally { setSaving(false); } };
  const handRows = handEnteredRows(doc, tx.transaction_id);
  const addRowByHand = async (values: Record<string, string>, why: string) => {
    if (locked) throw new Error('This result is locked');
    setSaving(true); setError('');
    try { const next = addRow(doc, tx.transaction_id, rowColumns(tx, profile), values, why); await putBatch(next); onSaved(next); } finally { setSaving(false); }
  };
  const approve = async () => { const result = approveTransaction(doc, tx.transaction_id, 'Reviewed and approved in workspace'); if (result.ok) await save(result.batch); else setError(result.error); };
  const copy = async () => { try { await navigator.clipboard.writeText(json); setCopied(true); } catch(e) { setError(`Copy failed: ${String(e)}`); } };
  const selectedField = view.fields.find(f => f.pointer === selected);
  const visibleFields = view.fields.filter(field => !profile || Object.hasOwn(tx.data, field.key) || field.exception === 'missing');
  const totals = reconcileTotals(tx);
  const fieldForIssue = (issue: typeof view.issues[number]) => issue.scope === 'transaction' && issue.target_id === tx.transaction_id ? visibleFields.find(f => issue.message.startsWith(`${f.pointer}:`)) : issue.scope === 'evidence' ? visibleFields.find(f => doc.evidence.some(e => e.evidence_id === issue.target_id && e.transaction_id === tx.transaction_id && e.field_pointer === f.pointer)) : undefined;
  const renderField = (field: typeof view.fields[number]) => {
    const validation = view.issues.filter(i => i.status === 'open' && ['blocking', 'error'].includes(i.severity) && fieldForIssue(i)?.pointer === field.pointer);
    return <article className="workspace-field" key={field.pointer}>
      <div className="workspace-field-header"><strong>{label(field.key)}</strong>{validation.length > 0 && <StatusPill tone="warning" icon="alert">Validation error</StatusPill>}</div>
      {editing === field.pointer ? <form onSubmit={e => { e.preventDefault(); if (!reason.trim()) return; try { void save(correctField(doc, tx.transaction_id, field.pointer, draft, reason.trim())); } catch(err) { setError(String(err)); } }}><Field label={`Edit ${field.key}`}><Input autoFocus value={draft} onChange={e => setDraft(e.target.value)} /></Field><Field label="Correction reason"><Input required value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={saving || locked || !reason.trim()}>Save correction</Button><Button disabled={saving} onClick={() => setEditing(undefined)}>Cancel</Button></form> : <Button variant="ghost" className="workspace-field-value" aria-label={`Edit ${label(field.key)}`} title={`Edit ${label(field.key)}`} disabled={saving || locked} onClick={() => { setEditing(field.pointer); setDraft(String(field.value ?? '')); setReason('Manual correction'); }}>{typeof field.value === 'object' && field.value !== null ? JSON.stringify(field.value) : String(field.value ?? '') || 'Missing value'}</Button>}
      <div className="workspace-field-meta"><span className="ds-muted">Extraction confidence: {field.confidence === null ? 'unavailable' : `${Math.round(field.confidence * 100)}%`}</span>{field.exception === 'low_confidence' && <StatusPill tone="warning" icon="alert">Review extraction</StatusPill>}<Button variant="ghost" size="sm" aria-expanded={details === field.pointer} onClick={() => setDetails(details === field.pointer ? undefined : field.pointer)}>Details for {label(field.key)}</Button></div>
      {validation.map(i => <p key={i.issue_id}>Validation result: {i.message.slice(field.pointer.length + 1).trim()}</p>)}
      {details === field.pointer && <div><p>Validation result: {validation.length ? 'See errors above.' : 'No field-specific errors reported.'}</p>{field.evidence ? <Button aria-pressed={selected === field.pointer} onClick={() => { setSelected(field.pointer); setPage(field.evidence!.page); }}>View source for {label(field.key)}</Button> : <p>Source location unavailable.</p>}</div>}
    </article>;
  };
  const fieldContent = <div className="workspace-fields">
    <section aria-label="Document info" className="workspace-field-group"><h3>Document info</h3>{visibleFields.some(field => sectionOf(field.key, profile) === 'info') ? visibleFields.filter(field => sectionOf(field.key, profile) === 'info').map(renderField) : <p className="ds-muted">No document info fields.</p>}</section>
    <section aria-label="Row data" className="workspace-field-group"><h3>Row data</h3><DataTable caption="Line items" rows={view.lineItems.map((item, index) => ({ item, index }))} rowKey={r => String(r.index)} columns={[...new Set(view.lineItems.flatMap(item => Object.keys(item)))].map(key => ({ key, label: label(key), render: (r: { item: Record<string, unknown>; index: number }) => {
      const pointer = `/line_items/${r.index}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
      return editing === pointer ? <form onSubmit={e => { e.preventDefault(); if (reason.trim()) { try { void save(correctField(doc, tx.transaction_id, pointer, draft, reason.trim())); } catch (err) { setError(String(err)); } } }}><Field label={`Edit ${label(key)}`}><Input value={draft} onChange={e => setDraft(e.target.value)} /></Field><Field label="Correction reason"><Input required value={reason} onChange={e => setReason(e.target.value)} /></Field><Button type="submit" disabled={saving || locked || !reason.trim()}>Save correction</Button><Button onClick={() => setEditing(undefined)}>Cancel</Button></form> : <Button aria-label={`Edit ${label(key)} row ${r.index + 1}`} disabled={locked} onClick={() => { setEditing(pointer); setDraft(String(r.item[key] ?? '')); setReason('Manual correction'); }}>{String(r.item[key] ?? '') || 'Missing value'}</Button>;
    } })).concat(handRows.size ? [{ key: 'entered_by_hand', label: 'Source', render: (r: { item: Record<string, unknown>; index: number }) => handRows.has(r.index) ? <StatusPill tone="info" icon="info">Entered by hand</StatusPill> : <></> }] : [])} emptyMessage="No line items" />
      {Array.isArray(tx.data.line_items) && <div className="ds-row"><Button disabled={saving || locked || !!busy} onClick={() => setAddingRow(true)}>Add row</Button></div>}
      {view.lineItems.length > 0 && (addingColumn ? <form onSubmit={e => { e.preventDefault(); const name = columnLabel.trim(); if (!name) return; setColumnError(''); if (!/[a-z0-9]/i.test(name.normalize('NFKD'))) { setColumnError('Column name must contain a Latin letter or number.'); return; } const taken = new Set(view.lineItems.flatMap(item => Object.keys(item))); const key = keyFromLabel(name, taken); try { void save(addLineItemColumn(doc, tx.transaction_id, key, `Added column: ${name}`)).then(ok => { if (ok) { setAddingColumn(false); setColumnLabel(''); } }); } catch (err) { setColumnError(String(err)); } }}><Field label="Column name" error={columnError || undefined}><Input autoFocus required maxLength={100} value={columnLabel} onChange={e => { setColumnLabel(e.target.value); setColumnError(''); }} /></Field><p className="ds-muted">Adds an optional text column to this transaction only; templates are unchanged. Names use Latin letters or digits and are normalized for display.</p><Button type="submit" disabled={saving || locked || !columnLabel.trim()}>Add row column</Button><Button disabled={saving} onClick={() => setAddingColumn(false)}>Cancel</Button></form> : <Button disabled={saving || locked} onClick={() => { setColumnLabel(''); setColumnError(''); setAddingColumn(true); }}>Add row column</Button>)}
    </section>
    {(totals || visibleFields.some(field => sectionOf(field.key, profile) === 'footer')) && <section aria-label="Footer" className="workspace-field-group"><h3>Footer</h3>{totals && <div className="ds-row" role="group" aria-label="Totals check"><span>Rows add up to {padDecimals(totals.net)}{totals.tax !== null && <> · tax {totals.tax}</>} · grand total {totals.total}</span><StatusPill tone={totals.ok ? 'success' : 'danger'} icon={totals.ok ? 'check' : 'alert'}>{totals.ok ? 'Matches' : 'Does not match'}</StatusPill></div>}{totals && !totals.ok && <p className="ds-muted">The rows and the grand total disagree. Correct a value, or waive the mismatch under Issues if the document prints other charges.</p>}{visibleFields.filter(field => sectionOf(field.key, profile) === 'footer').map(renderField)}</section>}
  </div>;
  return <section className="ds-sheet">
    <PageHeader breadcrumb={<><a href="#/">Home</a> / <a href="#/documents">Documents</a> / Workspace</>} title={file.filename} description={`${readable(view.documentType)} · ${doc.pages.length} pages`} actions={<div className="ds-row"><StatusPill>{readable(tx.status)}</StatusPill><Button variant="primary" disabled={!view.canApprove || saving || locked} aria-describedby="approval-reason" onClick={() => void approve()}>Approve</Button>{onReextract && <Button disabled={saving || locked || !!busy} onClick={() => setCustomizing(true)}>Customize fields</Button>}<Menu label="Export" items={[{ label: 'Clean JSON', disabled: !eligible, onSelect: () => downloadJSON(`${base}.json`, clean) }, { label: 'Grouped JSON', disabled: !eligible, onSelect: () => downloadJSON(`${base}.grouped.json`, grouped) }, { label: 'Full evidence JSON', disabled: !eligible, onSelect: () => downloadJSON(`${base}.evidence.json`, evidence) }]} /><Button disabled={!eligible} onClick={() => void copy()}>Copy</Button></div>} />
    {(!view.canApprove || !eligible) && <Notice tone="warning"><span id="approval-reason">{view.blockingCount} blockers. {tx.status === 'approved' ? 'This transaction is already approved.' : view.blockingCount ? 'Resolve blocking issues before approval, copying or exporting.' : 'Confirm document boundaries and resolve validation errors before approval or export.'} <a href="#workspace-issues" onClick={event => { event.preventDefault(); setTab('issues'); }}>Review issues</a></span></Notice>}
    {busy && <Notice><Progress label={busy} /><ul role="status" aria-live="polite" aria-label="Agent activity">{steps.map((step, i) => <li key={i}>{step.summary}</li>)}</ul></Notice>}
    {!busy && onRetry && doc.pages.some(p => p.status !== 'classified') && <Button onClick={onRetry}>Retry extraction</Button>}
    {error && <Notice tone="error">{error}</Notice>}{copied && <Notice>JSON copied.</Notice>}
    {locked && <Notice tone="info">Reading this file again with your new template. This result is locked and stays unchanged until the new one finishes; cancel the extraction to keep working on it.</Notice>}
    {onReextract && !profile && <TemplateLibraryBar key={tx.transaction_id} tx={tx} documentType={view.documentType} reviewCount={doc.reviews.length} documentCount={doc.documents.length} disabled={saving || locked || !!busy} onExtract={onReextract} />}
    {addingRow && <AddRow columns={rowColumns(tx, profile)} label={label} rowNumber={view.lineItems.length + 1} approved={tx.status === 'approved'} onClose={() => setAddingRow(false)} onAdd={addRowByHand} />}
    {customizing && onReextract && <CustomizeFields start={templateFromTransaction(tx, view.documentType, uniqueProfileName(profile ? `${profile.name} (edited)` : 'My template', loadProfiles()), profile)} reviewCount={doc.reviews.length} documentCount={doc.documents.length} onClose={() => setCustomizing(false)} onExtract={onReextract} />}
    {doc.transactions.length > 1 && <div className="ds-sheet"><Field label="Search transactions"><Input value={transactionSearch} onChange={e => setTransactionSearch(e.target.value)} /></Field><Field label="Transaction"><Select value={tx.transaction_id} onChange={e => { setTxId(e.target.value); setSelected(undefined); setEditing(undefined); setDetails(undefined); setAddingColumn(false); }}>{doc.documents.map(document => <optgroup key={document.document_id} label={`${document.document_id} · ${readable(document.document_type)}`}>{doc.transactions.filter(t => t.document_id === document.document_id && (t.transaction_id === tx.transaction_id || `${t.transaction_id} ${t.transaction_type} ${JSON.stringify(t.data)}`.toLowerCase().includes(transactionSearch.toLowerCase()))).map(t => <option key={t.transaction_id} value={t.transaction_id}>{t.transaction_id} · {readable(t.transaction_type)}</option>)}</optgroup>)}</Select></Field></div>}
    <div ref={splitRef} className="workspace-split" style={{ '--viewer-width': `${viewerWidth}%` } as CSSProperties}><Card id={viewerId}><EvidenceViewer pages={doc.pages.filter(p => p.file_id === file.file_id).map(p => { const rendered = pages.find(r => r.page === p.page_number); return { number: p.page_number, pending: p.status !== 'classified', src: rendered ? `data:${rendered.mimeType};base64,${rendered.data}` : undefined }; })} page={page} onPageChange={setPage} selected={selectedField?.pointer} error={renderError} boxes={view.fields.filter(f => f.evidence?.page === page).map(f => ({ id: f.pointer, label: readable(f.key), ...f.evidence!.bbox }))} /></Card>
    <Button variant="ghost" className="workspace-divider" role="separator" aria-label="Resize document viewer" aria-orientation="vertical" aria-controls={viewerId} aria-valuemin={30} aria-valuemax={70} aria-valuenow={viewerWidth} aria-valuetext={`${viewerWidth}% document viewer width`} title="Drag or use arrow keys to resize the document viewer" onPointerDown={event => { if (event.button !== 0) return; dragPointer.current = event.pointerId; event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerMove={event => { if (dragPointer.current !== event.pointerId) return; const rect = splitRef.current?.getBoundingClientRect(); if (rect?.width) setViewerWidth(Math.round(Math.max(30, Math.min(70, (event.clientX - rect.left) / rect.width * 100)))); }} onPointerUp={() => { dragPointer.current = null; }} onPointerCancel={() => { dragPointer.current = null; }} onLostPointerCapture={() => { dragPointer.current = null; }} onDoubleClick={() => setViewerWidth(50)} onKeyDown={event => { const value = event.key === 'ArrowLeft' ? viewerWidth - 2 : event.key === 'ArrowRight' ? viewerWidth + 2 : event.key === 'Home' ? 30 : event.key === 'End' ? 70 : undefined; if (value !== undefined) { event.preventDefault(); setViewerWidth(Math.max(30, Math.min(70, value))); } }} />
    <Card><div id="workspace-issues"><Tabs label="Transaction details" value={tab} onChange={setTab} items={[
      { id: 'fields', label: 'Fields', content: fieldContent },
      { id: 'issues', label: `Issues (${view.issues.filter(i => i.status === 'open').length})`, content: <div className="ds-sheet">{view.issues.length ? [...view.issues].sort((a, b) => Number(b.status === 'open' && ['blocking', 'error'].includes(b.severity)) - Number(a.status === 'open' && ['blocking', 'error'].includes(a.severity))).map(i => { const source = fieldForIssue(i); return <Card key={i.issue_id}><h2>{issueTitle(i.rule_code)}</h2><StatusPill tone={['blocking','error'].includes(i.severity) ? 'danger' : i.severity === 'info' ? 'info' : 'warning'} icon={i.severity === 'info' ? 'info' : 'alert'}>{readable(i.severity)}</StatusPill><p>{i.message}</p>{source?.evidence && <Button onClick={() => { setSelected(source.pointer); setPage(source.evidence!.page); }}>View source for {label(source.key)}</Button>}<p>Target: {i.scope} · {i.target_id} · {readable(i.status)}</p><small className="ds-muted">{i.rule_code}</small></Card>; }) : <p>No issues found.</p>}</div> },
      { id: 'json', label: 'JSON', content: <div className="ds-sheet"><Segmented label="JSON format" value={full} onChange={v => { setFull(v); setCopied(false); }} options={[{ value: 'clean', label: 'Clean' }, { value: 'grouped', label: 'Grouped' }, { value: 'full', label: 'Full evidence' }]} /><div className="ds-row"><Button disabled={!eligible} onClick={() => void copy()}>Copy JSON</Button><Button disabled={!eligible} onClick={() => downloadJSON(`${base}${full === 'full' ? '.evidence' : full === 'grouped' ? '.grouped' : ''}.json`, json)}>Download JSON</Button></div><pre className="ds-json">{json}</pre></div> },
    ]} /></div></Card></div>
  </section>;
}
