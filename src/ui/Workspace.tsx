import { useEffect, useMemo, useRef, useState } from 'react';
import { getFile, putDocument } from '../lib/db';
import { renderFile, type RenderedPage } from '../lib/pdf';
import { LOW_CONFIDENCE, cleanJson, validate } from '../lib/validate';
import type { DocumentRecord, Envelope } from '../lib/types';

type Tab = 'fields' | 'json';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function Workspace({ doc, onSaved }: { doc: DocumentRecord; onSaved: (d: DocumentRecord) => void }) {
  const env = doc.envelope;
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [renderErr, setRenderErr] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('fields');
  const [full, setFull] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  useEffect(() => {
    let live = true;
    getFile(doc.id)
      .then((b) => (b ? renderFile(b) : []))
      .then((p) => live && setPages(p))
      .catch((e) => live && setRenderErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [doc.id]);

  // Exception-first: missing / low-confidence fields first, then the rest.
  const keys = useMemo(() => {
    const bad = new Set([...env.validation.missing_required, ...env.validation.low_confidence]);
    const all = [...new Set([...Object.keys(env.extraction).filter((k) => k !== 'line_items'), ...env.validation.missing_required])];
    return all.sort((a, b) => Number(bad.has(b)) - Number(bad.has(a)));
  }, [env]);

  const select = (k: string) => {
    setSelected(k);
    const page = env.evidence[k]?.page;
    if (page) pageRefs.current[page]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const save = async (next: Envelope) => {
    const rec = { ...doc, envelope: next };
    await putDocument(rec);
    onSaved(rec);
  };

  const commitEdit = async (k: string) => {
    const prev = env.extraction[k];
    const numeric = /(amount|price|total|quantity)/.test(k) && draft.trim() !== '' && !Number.isNaN(Number(draft));
    const value = numeric ? Number(draft) : draft;
    const extraction = { ...env.extraction, [k]: value };
    const evidence = { ...env.evidence, [k]: { ...(env.evidence[k] ?? { page: 1, bbox: null }), confidence: 1 } };
    const validation = validate(env.document_type, extraction, evidence);
    setEditing(null);
    await save({
      ...env,
      extraction,
      evidence,
      validation,
      status: validation.needs_review ? 'review_required' : 'ready',
      audit: [...env.audit, { at: new Date().toISOString(), action: 'field_edited', field: k, from: prev, to: value }],
    });
  };

  const approve = () =>
    save({ ...env, status: 'approved', audit: [...env.audit, { at: new Date().toISOString(), action: 'approved' }] });

  const json = JSON.stringify(full ? env : cleanJson(env), null, 2);
  const base = doc.name.replace(/\.[^.]+$/, '');

  return (
    <section className="workspace">
      <header className="ws-head">
        <div>
          <h1>{doc.name}</h1>
          <span className={`badge ${env.status}`}>{env.status.replace('_', ' ')}</span>{' '}
          <span className="muted">{env.document_type.replace(/_/g, ' ')}</span>
        </div>
        <div className="actions">
          <button className="btn" disabled={env.status === 'approved' || env.validation.needs_review} onClick={approve}
            title={env.validation.needs_review ? 'Resolve the review items first' : ''}>
            Approve
          </button>
          <button className="btn primary" onClick={() => download(`${base}.json`, json)}>
            Export JSON
          </button>
        </div>
      </header>

      <div className="ws-grid">
        <div className="pane viewer" aria-label="Document">
          {renderErr && <p className="warn">Could not render the document: {renderErr}</p>}
          {!pages.length && !renderErr && <p className="muted">Loading document…</p>}
          {pages.map((p) => (
            <div key={p.page} className="page-wrap" ref={(el) => { pageRefs.current[p.page] = el; }}>
              <img src={`data:${p.mimeType};base64,${p.data}`} alt={`Page ${p.page}`} width={p.width} height={p.height} />
              {selected && env.evidence[selected]?.page === p.page && env.evidence[selected].bbox && (
                <div className="bbox" data-testid="bbox" style={(() => {
                  const [x0, y0, x1, y1] = env.evidence[selected].bbox!;
                  return { left: `${x0 * 100}%`, top: `${y0 * 100}%`, width: `${(x1 - x0) * 100}%`, height: `${(y1 - y0) * 100}%` };
                })()} />
              )}
              <span className="page-no">Page {p.page}</span>
            </div>
          ))}
        </div>

        <div className="pane side">
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === 'fields'} onClick={() => setTab('fields')}>Fields</button>
            <button role="tab" aria-selected={tab === 'json'} onClick={() => setTab('json')}>JSON</button>
          </div>

          {tab === 'fields' ? (
            <>
              <div className="validation">
                {env.validation.missing_required.length > 0 && <p className="warn">Missing: {env.validation.missing_required.join(', ')}</p>}
                {env.validation.totals_match === false && <p className="warn">Line items do not add up to the total.</p>}
                {!env.validation.needs_review && <p className="ok">All checks passed.</p>}
              </div>
              <ul className="fields">
                {keys.map((k) => {
                  const ev = env.evidence[k];
                  const low = ev && ev.confidence < LOW_CONFIDENCE;
                  const missing = env.validation.missing_required.includes(k);
                  return (
                    <li key={k} className={`${selected === k ? 'sel' : ''} ${low || missing ? 'exc' : ''}`}>
                      <button className="row" onClick={() => select(k)}>
                        <span className="k">{k.replace(/_/g, ' ')}</span>
                        <span className="conf">{ev ? `${Math.round(ev.confidence * 100)}%` : '—'}</span>
                      </button>
                      {editing === k ? (
                        <form onSubmit={(e) => { e.preventDefault(); void commitEdit(k); }}>
                          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={`Edit ${k}`} />
                          <button className="btn primary" type="submit">Save</button>
                        </form>
                      ) : (
                        <div className="val">
                          <span>{String(env.extraction[k] ?? '') || <em className="muted">empty</em>}</span>
                          {env.status !== 'approved' && (
                            <button className="link" onClick={() => { setEditing(k); setDraft(String(env.extraction[k] ?? '')); }}>
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!!env.extraction.line_items?.length && (
                <table className="items">
                  <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Amount</th></tr></thead>
                  <tbody>
                    {env.extraction.line_items.map((it, i) => (
                      <tr key={i}><td>{it.description}</td><td>{it.quantity}</td><td>{it.unit_price}</td><td>{it.amount}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          ) : (
            <>
              <div className="json-bar">
                <label><input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> Full evidence JSON</label>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(json)}>Copy</button>
              </div>
              <pre className="json">{json}</pre>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
