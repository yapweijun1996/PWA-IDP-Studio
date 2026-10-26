import { useCallback, useEffect, useState } from 'react';
import { getBatch, getFile, listBatches, putBatch, putFile } from '../lib/db';
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

  /** Renders pages and runs extraction for an already stored original; a failure keeps the batch as `failed` so it can be retried. */
  const extractInto = async ({ file, info, manifest, id, createdAt, pending }: { file: File | Blob; info: Parameters<typeof buildBatch>[0]['file']; manifest: Parameters<typeof buildBatch>[0]['pages']; id: string; createdAt: string; pending: Batch }) => {
    const name = info.filename;
    try {
      setBusy(`${name}: rendering pages…`);
      const pages = await renderFile(file, { maxPages: settings.maxPages });
      const batch = await runExtraction({ batchId: id, createdAt, file: info, manifest, pages, settings, onStatus: m => setBusy(`${name}: ${m}`) });
      await putBatch(batch);
    } catch (e) {
      const failed = recomputeIssues({ ...pending, pages: pending.pages.map(p => ({ ...p, status: 'error' as const, unassigned_reason: 'review_pending' as const })) });
      failed.batch.status = 'failed';
      failed.issues = failed.issues.filter(i => i.rule_code !== 'EXTRACTION_FAILED' && i.rule_code !== 'PAGE_LIMIT_EXCEEDED');
      failed.issues.push({ issue_id: 'extraction_failed', scope: 'batch', target_id: id, rule_code: 'EXTRACTION_FAILED', severity: 'blocking', message: String((e as Error).message), status: 'open', waiver_review_id: null });
      await putBatch(failed);
    }
  };

  const retry = async (batchId: string) => {
    if (navigator.onLine === false) { setOfflineUpload(true); return; }
    if (busy) return;
    setError('');
    try {
      const existing = await getBatch(batchId);
      const source = existing?.source_files[0];
      const blob = source ? await getFile(source.file_id) : undefined;
      if (!existing || !source || !blob) throw new Error('The original file is missing from this browser. Upload it again.');
      const info = { file_id: source.file_id, filename: source.filename, media_type: source.media_type, sha256: source.sha256, size: blob.size };
      const manifest = existing.pages.map(p => ({ page_number: p.page_number, width: p.width, height: p.height }));
      const placeholder = buildBatch({ batchId, createdAt: existing.batch.created_at, file: info, pages: manifest, renderedPageCount: 1, model: null, output: { document_type: 'unknown', fields: [], line_items: [] } });
      for (const page of placeholder.pages) { page.status = 'pending'; page.regions = []; page.unassigned_reason = 'review_pending'; }
      placeholder.documents = []; placeholder.transactions = [];
      const pending = recomputeIssues(placeholder);
      pending.batch.status = 'processing';
      await putBatch(pending);
      await refresh();
      await extractInto({ file: blob, info, manifest, id: batchId, createdAt: existing.batch.created_at, pending });
      await refresh();
    } catch (e) { setError(String((e as Error).message)); }
    setBusy(null);
  };

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
        await extractInto({ file, info, manifest, id, createdAt, pending });
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
    else body = <Workspace key={current.batch.batch_id} doc={current} busy={busy} onRetry={() => retry(current.batch.batch_id)} transactionId={route.transactionId} onSaved={d => { setCurrent(d); void refresh(); }} />;
  } else body = <Home onRetry={retry} docs={docs} settings={settings} busy={busy} search={search} loading={loading} offlineUpload={offlineUpload} onFiles={process} onDeleted={refresh} />;
  return (
    <AppShell brand="IDP Studio" items={navItems(route.name, reviewRows(docs).length)} search={route.name === 'home' || route.name === 'documents' ? <SearchInput placeholder="Search documents…" value={search} onChange={setSearch} /> : undefined} right={<OnlineStatus />} footer={<>Version {APP_VERSION} · Build {BUILD_ID}</>}>
      {error && <Notice tone="error">{error}</Notice>}
      {body}
      <UpdatePrompt />
    </AppShell>
  );
}
