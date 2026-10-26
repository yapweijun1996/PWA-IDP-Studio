import { useEffect, useRef, useState } from 'react';
import { getFileByFileId, putBatch } from '../lib/db';
import { renderFile, type RenderedPage } from '../lib/pdf';
import { loadSettings } from '../lib/settings';
import type { Batch } from '../contract/types';
import { transactionView } from '../contract/view';
import { approveTransaction, correctField } from '../contract/review';
import { exportEligibleTransactions, validateBatch } from '../contract/validate';
import { Icon } from './Icon';

type Tab = 'fields' | 'json';
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
export function Workspace({ doc, onSaved }: { doc: Batch; onSaved: (d: Batch) => void }) {
  const tx = doc.transactions[0];
  const view = transactionView(doc, tx.transaction_id);
  const file = doc.source_files[0];
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [renderErr, setRenderErr] = useState('');
  const [saveErr, setSaveErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('fields');
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const selectedEvidence = view.fields.find(f => f.pointer === selected)?.evidence;
  useEffect(() => {
    let live = true;
    getFileByFileId(file.file_id).then(blob => {
      if (!blob) throw new Error('Original file is missing');
      return renderFile(blob, { maxPages: loadSettings().maxPages });
    }).then(p => { if (live) setPages(p); }).catch(e => { if (live) setRenderErr(String(e.message ?? e)); });
    return () => { live = false; };
  }, [file.file_id]);
  const select = (pointer: string) => {
    setSelected(pointer);
    const page = view.fields.find(f => f.pointer === pointer)?.evidence?.page;
    if (page) pageRefs.current[page]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const save = async (next: Batch) => {
    setSaving(true);
    setSaveErr('');
    try { await putBatch(next); onSaved(next); setEditing(null); }
    catch (e) { setSaveErr(String((e as Error).message)); }
    finally { setSaving(false); }
  };
  const commitEdit = async (pointer: string) => {
    try { await save(correctField(doc, tx.transaction_id, pointer, draft, 'Corrected field in workspace')); }
    catch (e) { setSaveErr(String((e as Error).message)); }
  };
  const approve = async () => {
    const result = approveTransaction(doc, tx.transaction_id, 'Reviewed and approved in workspace');
    if (result.ok) await save(result.batch);
    else setSaveErr(result.error);
  };
  const json = JSON.stringify(full ? doc : { document_type: view.documentType, ...tx.data }, null, 2);
  const eligible = validateBatch(doc).ok && exportEligibleTransactions(doc).includes(tx.transaction_id);
  const base = file.filename.replace(/\.[^.]+$/, '');
  return (
    <section className="workspace">
      <header className="ws-head">
        <div><h1>{file.filename}</h1><span className={`badge ${view.status}`}>{view.status.replace(/_/g, ' ')}</span>{' '}<span className="muted">{view.documentType.replace(/_/g, ' ')} · {doc.pages.length} pages</span></div>
        <div className="actions">
          <button className="btn" disabled={!view.canApprove || saving} onClick={() => void approve()} title={view.blockingCount ? 'Resolve blocking issues first' : ''}><Icon name="check" /> Approve</button>
          <button className="btn primary" disabled={!eligible} title={!eligible ? 'Resolve blocking issues before export' : ''} onClick={() => download(`${base}.json`, json)}><Icon name="download" /> Export JSON</button>
        </div>
      </header>
      {saveErr && <p className="warn" role="alert">{saveErr}</p>}
      <div className="ws-grid">
        <div className="pane viewer" aria-label="Document">
          {renderErr && <p className="warn">Could not render the document: {renderErr}</p>}
          {!pages.length && !renderErr && <p className="muted">Loading document…</p>}
          {pages.length > 0 && pages.length < doc.pages.length && <p className="muted">Showing {pages.length} of {doc.pages.length} pages. Increase the page limit in Settings to view more.</p>}
          {pages.map(p => (
            <div key={p.page} className="page-wrap" ref={el => { pageRefs.current[p.page] = el; }}>
              <img src={`data:${p.mimeType};base64,${p.data}`} alt={`Page ${p.page}`} width={p.width} height={p.height} />
              {selectedEvidence?.page === p.page && <div className="bbox" data-testid="bbox" style={{ left: `${selectedEvidence.bbox.x * 100}%`, top: `${selectedEvidence.bbox.y * 100}%`, width: `${selectedEvidence.bbox.width * 100}%`, height: `${selectedEvidence.bbox.height * 100}%` }} />}
              <span className="page-no">Page {p.page}</span>
            </div>
          ))}
        </div>
        <div className="pane side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'fields'} onClick={() => setTab('fields')}>Fields</button>
            <button role="tab" aria-selected={tab === 'json'} onClick={() => setTab('json')}>JSON</button>
          </div>
          {tab === 'fields' ? <>
            <div className="validation">
              {view.issues.filter(i => i.status === 'open').map(i => <p key={i.issue_id} className={i.severity === 'info' ? 'muted' : 'warn'}>{i.rule_code}: {i.message}</p>)}
              {!view.issues.some(i => i.status === 'open' && i.severity !== 'info') && <p className="ok">All checks passed.</p>}
            </div>
            <ul className="fields">{view.fields.map(field => (
              <li key={field.pointer} className={`${selected === field.pointer ? 'sel' : ''} ${field.exception ? 'exc' : ''}`}>
                <button className="row" onClick={() => select(field.pointer)}><span className="k">{field.key.replace(/_/g, ' ')}</span><span className="conf">{field.confidence === null ? '—' : `${Math.round(field.confidence * 100)}%`}</span></button>
                {editing === field.pointer ? <form onSubmit={e => { e.preventDefault(); void commitEdit(field.pointer); }}><input autoFocus value={draft} onChange={e => setDraft(e.target.value)} aria-label={`Edit ${field.key}`} /><button className="btn primary" type="submit" disabled={saving}>Save</button></form> : <div className="val"><span>{String(field.value ?? '') || <em className="muted">empty</em>}</span>{view.status !== 'approved' && <button className="link" disabled={saving} onClick={() => { setEditing(field.pointer); setDraft(String(field.value ?? '')); }}><Icon name="edit" size="sm" /> Edit</button>}</div>}
              </li>
            ))}</ul>
            {!!view.lineItems.length && <table className="items"><thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead><tbody>{view.lineItems.map((it, i) => <tr key={i}><td>{String(it.description ?? '')}</td><td>{String(it.quantity ?? '')}</td><td>{String(it.unit_price ?? '')}</td><td>{String(it.amount ?? '')}</td></tr>)}</tbody></table>}
          </> : <>
            <div className="json-bar"><label><input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)} /> Full JSON (batch; unchecked: Clean JSON)</label><button className="btn" disabled={!eligible} onClick={() => void navigator.clipboard?.writeText(json)}><Icon name="copy" /> Copy</button></div>
            <pre className="json">{json}</pre>
          </>}
        </div>
      </div>
    </section>
  );
}
