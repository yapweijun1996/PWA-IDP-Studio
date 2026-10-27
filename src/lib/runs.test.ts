import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { deleteBatch, listRuns, putRun, type RunTrace } from './db';
import { clearLocalData, deleteLocalBatch } from '../ui/storage';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
const trace = (n: number): RunTrace => ({ id: String(n), batchId: n % 2 ? 'odd' : 'even', filename: 'file.pdf', provider: 'demo', model: 'test', mode: 'auto', started: n, ended: n + 1, segmentationWindows: 0, documentsExtracted: 1, documentsFailed: 0, steps: [{ at: n, tool: 'submit_result', summary: 'SECRET extracted value', ok: true }], outcome: 'review_required', error: 'SECRET provider response' });
beforeEach(async () => { await clearLocalData(); });
it('retains the newest 50 traces, bounds steps and strips payload content', async () => {
  for (let n = 0; n < 52; n++) await putRun(trace(n));
  const latest = trace(100); latest.steps = Array.from({ length: 201 }, () => latest.steps[0]);
  await putRun(latest);
  const runs = await listRuns();
  expect(runs.map(r => r.started)).toEqual([100, ...Array.from({ length: 49 }, (_, i) => 51 - i)]);
  expect(runs[0].steps).toHaveLength(200);
  expect(JSON.stringify(runs)).not.toContain('SECRET');
  await deleteBatch('even');
  expect((await listRuns()).every(r => r.batchId === 'odd')).toBe(true);
  await clearLocalData(); expect(await listRuns()).toEqual([]);
});
it('upgrades an existing v3 database without losing originals', async () => {
  await new Promise<void>((resolve, reject) => { const r = indexedDB.deleteDatabase('idp-studio'); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); });
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.open('idp-studio', 3);
    r.onupgradeneeded = () => { r.result.createObjectStore('files'); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { const db = r.result; const t = db.transaction('files', 'readwrite'); t.objectStore('files').put('original', 'keep'); t.oncomplete = () => { db.close(); resolve(); }; };
  });
  await putRun(trace(1));
  expect((await listRuns())[0].id).toBe('1');
  await new Promise<void>((resolve, reject) => { const r = indexedDB.open('idp-studio', 4); r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result; const t = db.transaction('files'); const q = t.objectStore('files').get('keep'); t.oncomplete = () => { expect(q.result).toBe('original'); db.close(); resolve(); }; }; });
});
it('removes matching traces through UI batch deletion without deleting other runs', async () => {
  const input = invoiceInput(); input.batchId = 'even';
  await putRun(trace(2)); await putRun(trace(3));
  await deleteLocalBatch(buildBatch(input));
  expect((await listRuns()).map(r => r.batchId)).toEqual(['odd']);
});
