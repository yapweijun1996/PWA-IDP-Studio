import { useCallback, useEffect, useState } from 'react';
import { getDocument, listDocuments, putDocument, putFile } from '../lib/db';
import { runExtraction } from '../lib/extract';
import { renderFile } from '../lib/pdf';
import { loadSettings, type Settings } from '../lib/settings';
import type { DocumentRecord, Envelope } from '../lib/types';
import { Home } from './Home';
import { SettingsPage } from './Settings';
import { Sidebar } from './Sidebar';
import { UpdatePrompt } from './UpdatePrompt';
import { go, useRoute } from './useHash';
import { Workspace } from './Workspace';

const placeholder = (id: string, status: Envelope['status']): Envelope => ({
  schema_version: '1.0',
  document_id: id,
  document_type: 'other',
  status,
  extraction: {},
  evidence: {},
  validation: { schema_valid: false, totals_match: null, missing_required: [], low_confidence: [], standards_issues: [], needs_review: false },
  model: null,
  audit: [],
});

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [current, setCurrent] = useState<DocumentRecord | null | undefined>(undefined);
  const [collapsed, setCollapsed] = useState(route.name === 'home');

  const refresh = useCallback(() => listDocuments().then(setDocs).catch(() => setDocs([])), []);
  useEffect(() => void refresh(), [refresh]);

  useEffect(() => {
    setCollapsed(route.name === 'home');
    if (route.name !== 'doc') return setCurrent(undefined);
    let live = true;
    getDocument(route.id).then((d) => live && setCurrent(d ?? null));
    return () => { live = false; };
  }, [route]);

  const process = async (files: File[]) => {
    let first: string | null = null;
    for (const [i, file] of files.entries()) {
      const id = `doc_${Date.now().toString(36)}${i}`;
      first ??= id;
      const base = { id, name: file.name, mime: file.type, size: file.size, createdAt: Date.now(), pageCount: 0 };
      await putFile(id, file);
      await putDocument({ ...base, envelope: placeholder(id, 'processing') });
      await refresh();
      try {
        setBusy(`${file.name}: rendering pages…`);
        const pages = await renderFile(file);
        const envelope = await runExtraction({
          documentId: id, pages, settings, onStatus: (m) => setBusy(`${file.name}: ${m}`),
        });
        await putDocument({ ...base, pageCount: pages.length, envelope });
      } catch (e) {
        await putDocument({ ...base, envelope: placeholder(id, 'failed'), error: (e as Error).message });
      }
      await refresh();
    }
    setBusy(null);
    if (first) go(`#/doc/${first}`);
  };

  let body;
  if (route.name === 'settings') body = <SettingsPage settings={settings} onChange={setSettings} />;
  else if (route.name === 'doc') {
    if (current === undefined) body = <p className="page muted">Loading…</p>;
    else if (current === null) body = <p className="page">Document not found. <a href="#/">Back</a></p>;
    else if (current.envelope.status === 'failed')
      body = <section className="page narrow"><h1>{current.name}</h1><p className="warn" role="alert">Extraction failed: {current.error}</p><a href="#/settings">Check settings</a></section>;
    else if (current.envelope.status === 'processing') body = <p className="page" role="status">{busy ?? 'Processing…'}</p>;
    else body = <Workspace doc={current} onSaved={(d) => { setCurrent(d); void refresh(); }} />;
  } else body = <Home docs={docs} settings={settings} busy={busy} onFiles={process} />;

  return (
    <div className={`shell ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="safe-top" aria-hidden />
      <Sidebar route={route} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main>{body}</main>
      <UpdatePrompt />
    </div>
  );
}
