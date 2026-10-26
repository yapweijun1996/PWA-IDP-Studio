import { useCallback, useEffect, useState } from 'react';
import { getBatch, listBatches, putBatch, putFile } from '../lib/db';
import { runExtraction } from '../lib/extract';
import { pageManifest, renderFile } from '../lib/pdf';
import { loadSettings, type Settings } from '../lib/settings';
import { sha256 } from '../lib/hash';
import { migrateStore } from '../lib/migrateStore';
import { buildBatch } from '../contract/build';
import { recomputeIssues } from '../contract/review';
import type { Batch, MediaType } from '../contract/types';
import { Home } from './Home';
import { SettingsPage } from './Settings';
import { AppShell, OnlineStatus } from '../ds';
import { ComponentSheet } from '../ds/ComponentSheet';
import { UpdatePrompt } from './UpdatePrompt';
import { go, useRoute } from './useHash';
import { Workspace } from './Workspace';

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [docs, setDocs] = useState<Batch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [migration, setMigration] = useState<{ migrated: number; skipped: number }>();
  const [current, setCurrent] = useState<Batch | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const batches = await listBatches();
    setDocs(batches);
    setCurrent(previous => previous ? batches.find(b => b.batch.batch_id === previous.batch.batch_id) ?? previous : previous);
  }, []);
  useEffect(() => {
    let live = true;
    migrateStore().then(result => { if (live) setMigration(result); return refresh(); }).catch(e => { if (live) setError(`Data migration: ${String(e.message ?? e)}`); });
    return () => { live = false; };
  }, [refresh]);
  useEffect(() => {
    if (route.name !== 'doc') { setCurrent(undefined); return; }
    let live = true;
    setCurrent(undefined);
    getBatch(route.id).then(d => { if (live) setCurrent(d ?? null); }).catch(e => { if (live) { setCurrent(null); setError(String(e.message ?? e)); } });
    return () => { live = false; };
  }, [route]);

  const process = async (files: File[]) => {
    if (busy) return;
    let first: string | null = null;
    setError('');
    for (const file of files) {
      const id = `batch_${crypto.randomUUID()}`;
      const file_id = `file_${crypto.randomUUID()}`;
      const createdAt = new Date().toISOString();
      try {
        setBusy(`${file.name}: reading all pages…`);
        const manifest = await pageManifest(file);
        const info = { file_id, filename: file.name, media_type: file.type as MediaType, sha256: await sha256(file), size: file.size };
        await putFile(file_id, file);
        const placeholder = buildBatch({ batchId: id, createdAt, file: info, pages: manifest, renderedPageCount: 1, model: null, output: { document_type: 'unknown', fields: [], line_items: [] } });
        for (const page of placeholder.pages) { page.status = 'pending'; page.regions = []; page.unassigned_reason = 'review_pending'; }
        placeholder.documents = [];
        placeholder.transactions = [];
        const pending = recomputeIssues(placeholder);
        pending.batch.status = 'processing';
        await putBatch(pending);
        first ??= id;
        await refresh();
        try {
          setBusy(`${file.name}: rendering pages…`);
          const pages = await renderFile(file, { maxPages: settings.maxPages });
          const batch = await runExtraction({ batchId: id, createdAt, file: info, manifest, pages, settings, onStatus: m => setBusy(`${file.name}: ${m}`) });
          await putBatch(batch);
        } catch (e) {
          pending.batch.status = 'failed';
          pending.issues.push({ issue_id: 'extraction_failed', scope: 'batch', target_id: id, rule_code: 'EXTRACTION_FAILED', severity: 'blocking', message: String((e as Error).message), status: 'open', waiver_review_id: null });
          await putBatch(pending);
        }
        await refresh();
      } catch (e) { setError(`${file.name}: ${String((e as Error).message)}`); }
    }
    setBusy(null);
    if (first) go(`#/doc/${first}`);
  };

  let body;
  if (route.name === 'settings') body = <SettingsPage settings={settings} onChange={setSettings} migration={migration} />;
  else if (route.name === 'design') body = <ComponentSheet />;
  else if (route.name === 'doc') {
    if (current === undefined) body = <p className="page muted">Loading…</p>;
    else if (current === null) body = <p className="page">Document not found. <a href="#/">Back</a></p>;
    else if (current.batch.status === 'failed') body = <section className="page narrow"><h1>{current.source_files[0].filename}</h1><p className="warn" role="alert">Extraction failed: {current.issues.find(i => i.rule_code === 'EXTRACTION_FAILED')?.message}</p><a href="#/settings">Check settings</a></section>;
    else if (current.batch.status === 'processing') body = <p className="page" role="status">{busy ?? 'Processing did not finish. Upload the original again to retry.'}</p>;
    else body = <Workspace key={current.batch.batch_id} doc={current} onSaved={d => { setCurrent(d); void refresh(); }} />;
  } else body = <Home docs={docs} settings={settings} busy={busy} onFiles={process} />;
  return (
    <AppShell items={[
      { href: '#/', label: 'Home', icon: 'home', active: route.name === 'home' },
      { href: '#/settings', label: 'Settings', icon: 'settings', active: route.name === 'settings' },
      { href: '#/design', label: 'Design system', icon: 'sliders', active: route.name === 'design' },
    ]} right={<OnlineStatus />} footer="IDP Studio">
      {error && <p role="alert" className="warn">{error}</p>}
      {body}
      <UpdatePrompt />
    </AppShell>
  );
}
