import { clearProfiles } from '../lib/profiles';
import type { Batch } from '../contract/types';
import type { BatchRecord } from '../lib/db';
import type { DocumentRecord } from '../lib/types';
// ES2022 target does not provide Promise.withResolvers; IndexedDB completes through events.
function mutate(run: (tx: IDBTransaction) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('idp-studio', 3);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('batches')) db.createObjectStore('batches', { keyPath: 'batch.batch.batch_id' });
      if (!db.objectStoreNames.contains('windowed')) db.createObjectStore('windowed');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['batches', 'files', 'documents', 'windowed'], 'readwrite');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      try { run(tx); } catch (error) { tx.abort(); reject(error); }
    };
  });
}
export function deleteLocalBatch(batch: Batch): Promise<void> {
  return mutate(tx => {
    const batches = tx.objectStore('batches');
    const originals = tx.objectStore('files');
    const legacy = tx.objectStore('documents');
    const all = batches.getAll();
    const documents = legacy.getAll();
    documents.onsuccess = () => {
      const remaining = (all.result as BatchRecord[]).filter(r => r.batch.batch.batch_id !== batch.batch.batch_id);
      const legacyRows = documents.result as DocumentRecord[];
      // Remove this migration source too, otherwise startup migration recreates the deleted upload.
      for (const row of legacyRows.filter(r => `legacy_${r.id}` === batch.batch.batch_id)) {
        legacy.delete(row.id);
        if (!remaining.some(r => r.batch.source_files.some(f => f.file_id === row.id || f.storage_ref === row.id))) originals.delete(row.id);
      }
      for (const source of batch.source_files) {
        const shared = remaining.some(r => r.batch.source_files.some(f => f.file_id === source.file_id || f.storage_ref === source.file_id));
        const legacySource = legacyRows.some(r => `legacy_${r.id}` !== batch.batch.batch_id && (r.id === source.file_id || `legacy_file_${r.id}` === source.file_id));
        if (!shared && !legacySource) originals.delete(source.file_id);
      }
      batches.delete(batch.batch.batch_id);
      tx.objectStore('windowed').delete(batch.batch.batch_id);
    };
  });
}
export async function clearLocalData(): Promise<void> {
  await mutate(tx => { for (const name of ['batches', 'files', 'documents', 'windowed']) tx.objectStore(name).clear(); });
  clearProfiles();
  for (const key of ['idp-studio.settings.v1', 'idp-studio.tables', 'idp-studio.theme', 'idp-studio.sidebar']) localStorage.removeItem(key);
}
