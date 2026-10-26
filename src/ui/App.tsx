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
import { Home } from './pages/Home';
import { SettingsPage } from './pages/Settings';
import { Documents } from './pages/Documents';
import { ReviewQueue } from './pages/ReviewQueue';
import { navItems, reviewRows } from './nav';
import { APP_VERSION, BUILD_ID } from './version';
import { AppShell, Notice, OnlineStatus, SearchInput, Spinner, useOnlineStatus } from '../ds';
import { ComponentSheet } from '../ds/ComponentSheet';
import { UpdatePrompt } from './UpdatePrompt';
import { go, useRoute } from './useHash';
import { Workspace } from './pages/Workspace';

export function App() {
  const route = useRoute();
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [docs, setDocs] = useState<Batch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const online = useOnlineStatus();
  const [offlineUpload, setOfflineUpload] = useState(false);
  useEffect(() => { if (online) setOfflineUpload(false); }, [online]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [migration, setMigration] = useState<{ migrated: number; skipped: number }>();
  const [current, setCurrent] = useState<Batch | null | undefined>(undefined);
  const refresh = useCallback(async () => {
    const batches = await listBatches();
    setDocs(batches);
    setCurrent(previous => previous ? batches.find(b => b.batch.batch_id === previous.batch.batch_id) ?? previous : previous);
  }, []);
  useEffect(() => {
    let live = true;
    migrateStore().then(result => { if (live) setMigration(result); return refresh(); }).catch(e => { if (live) setError(`Data migration: ${String(e.message ?? e)}`); }).finally(() => { if (live) setLoading(false); });
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
    if (navigator.onLine === false) { setOfflineUpload(true); return; }
    if (busy) return;
    let first: string | null = null;
    setError('');
    for (const original of files) {
      const inferred = ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' } as Record<string, string>)[original.name.split('.').pop()?.toLowerCase() ?? ''];
      const mime = original.type || inferred;
      if (!['application/pdf', 'image/png', 'image/jpeg'].includes(mime)) { setError(`${original.name}: Supported types are PDF, PNG, JPG. TIFF and WebP are not supported.`); continue; }
      const file = original.type ? original : new File([original], original.name, { type: mime });
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
        setOfflineUpload(false);
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
  if (route.name === 'settings') body = <SettingsPage settings={settings} onChange={setSettings} migration={migration} batchCount={docs.length} onCleared={async () => { setCurrent(undefined); setMigration({ migrated: 0, skipped: 0 }); await refresh(); }} />;
  else if (route.name === 'design') body = <ComponentSheet />;
  else if (route.name === 'documents') body = <Documents docs={docs} search={search} loading={loading} onDeleted={refresh} />;
  else if (route.name === 'review') body = <ReviewQueue docs={docs} loading={loading} />;
  else if (route.name === 'doc') {
    if (current === undefined) body = <Spinner label="Loading document…" />;
    else if (current === null) body = <Notice tone="error">Document not found. <a href="#/documents">Back to Documents</a></Notice>;
    else body = <Workspace key={current.batch.batch_id} doc={current} transactionId={route.transactionId} onSaved={d => { setCurrent(d); void refresh(); }} />;
  } else body = <Home docs={docs} settings={settings} busy={busy} search={search} loading={loading} offlineUpload={offlineUpload} onFiles={process} onDeleted={refresh} />;
  return (
    <AppShell brand="IDP Studio" items={navItems(route.name, reviewRows(docs).length)} search={route.name === 'home' || route.name === 'documents' ? <SearchInput placeholder="Search documents…" value={search} onChange={setSearch} /> : undefined} right={<OnlineStatus />} footer={<>Version {APP_VERSION} · Build {BUILD_ID}</>}>
      {error && <Notice tone="error">{error}</Notice>}
      {body}
      <UpdatePrompt />
    </AppShell>
  );
}
