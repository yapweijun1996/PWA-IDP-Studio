import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { getBatch, getFile, listBatches, putBatch, deleteBatch } from './db';
import { migrateStore } from './migrateStore';
import { sha256 } from './hash';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { validateBatch } from '../contract/validate';
import type { DocumentRecord } from './types';

vi.mock('./pdf', () => ({ pageManifest: vi.fn(async () => { throw new Error('Unreadable dimensions'); }), countPages: vi.fn(async () => 2) }));
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('Blob', NodeBlob);
  vi.stubGlobal('crypto', webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

async function seedV1(mime = 'application/pdf') {
  const record: DocumentRecord = { id: 'old', name: mime === 'image/webp' ? 'old.webp' : 'old.pdf', mime, size: 3, createdAt: Date.parse('2026-10-26T00:00:00Z'), pageCount: 1, envelope: { schema_version: '1.0', document_id: 'old', document_type: 'other', status: 'ready', extraction: { amount: 1 }, evidence: {}, model: null, audit: [], validation: { schema_valid: true, totals_match: null, missing_required: [], low_confidence: [], standards_issues: [], needs_review: false } } };
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('idp-studio', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('documents', { keyPath: 'id' });
      request.result.createObjectStore('files');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['documents', 'files'], 'readwrite');
      tx.objectStore('documents').put(record);
      tx.objectStore('documents').put({ ...record, id: 'missing' });
      tx.objectStore('files').put(new Blob(['abc'], { type: mime }), 'old');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  });
}
it('upgrades a real v1 store, retains originals, records fallback and skips absent files idempotently', async () => {
  await seedV1();
  expect(await migrateStore()).toEqual({ migrated: 1, skipped: 1 });
  const batch = (await getBatch('legacy_old'))!;
  expect(batch.source_files[0].sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(batch.pages.map(p => [p.width, p.height])).toEqual([[595, 842], [595, 842]]);
  expect(batch.issues.find(i => i.rule_code === 'LEGACY_DIMENSIONS_FALLBACK')?.severity).toBe('info');
  expect(validateBatch(batch).ok).toBe(true);
  expect(await (await getFile('old'))!.text()).toBe('abc');
  expect(await (await getFile(batch.source_files[0].file_id))!.text()).toBe('abc');
  expect(await migrateStore()).toEqual({ migrated: 0, skipped: 1 });
  expect(await listBatches()).toEqual([batch]);
  await deleteBatch('legacy_old');
  expect(await getBatch('legacy_old')).toBeUndefined();
  expect(await getFile('old')).toBeDefined();
});
it('migrates legacy WebP without relabeling the original media', async () => {
  await seedV1('image/webp');
  expect(await migrateStore()).toEqual({ migrated: 1, skipped: 1 });
  const batch = (await getBatch('legacy_old'))!;
  expect(batch.source_files[0]).toMatchObject({ filename: 'old.webp', media_type: 'image/webp' });
  expect((await getFile(batch.source_files[0].file_id))!.type).toBe('image/webp');
  expect(validateBatch(batch).ok).toBe(true);
});
it('stores batches under batch_id and hashes original bytes', async () => {
  const batch = buildBatch(invoiceInput());
  await putBatch(batch);
  expect(await getBatch(batch.batch.batch_id)).toEqual(batch);
  expect(await sha256(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
