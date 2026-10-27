import type { DocumentRecord } from './types';
import type { Batch } from '../contract/types';
import type { SegmentPlan, SegmentResult } from './windowed';

export interface WindowedState { plan: SegmentPlan; results: SegmentResult[] }

export interface BatchRecord { batch: Batch; createdAt: number }

const DB_NAME = 'idp-studio';
const DOCS = 'documents';
const FILES = 'files';
const BATCHES = 'batches';
const WINDOWED = 'windowed';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DOCS)) req.result.createObjectStore(DOCS, { keyPath: 'id' });
      if (!req.result.objectStoreNames.contains(FILES)) req.result.createObjectStore(FILES);
      if (!req.result.objectStoreNames.contains(BATCHES)) req.result.createObjectStore(BATCHES, { keyPath: 'batch.batch.batch_id' });
      if (!req.result.objectStoreNames.contains(WINDOWED)) req.result.createObjectStore(WINDOWED);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  stores: string[],
  mode: IDBTransactionMode,
  run: (t: IDBTransaction) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(stores, mode);
    const req = run(t);
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = t.onabort = () => {
      db.close();
      reject(t.error);
    };
  });
}


export const getDocument = (id: string) =>
  tx<DocumentRecord | undefined>([DOCS], 'readonly', (t) => t.objectStore(DOCS).get(id));

export async function listDocuments(): Promise<DocumentRecord[]> {
  const all = await tx<DocumentRecord[]>([DOCS], 'readonly', (t) => t.objectStore(DOCS).getAll());
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export const putFile = (id: string, blob: Blob) =>
  tx([FILES], 'readwrite', (t) => t.objectStore(FILES).put(blob, id));

export const getFile = (id: string) =>
  tx<Blob | undefined>([FILES], 'readonly', (t) => t.objectStore(FILES).get(id));


/** Legacy documents remain read-only. New files use their immutable file_id as key. */
export const getFileByFileId = getFile;

export const putBatch = (batch: Batch) =>
  tx([BATCHES], 'readwrite', t => t.objectStore(BATCHES).put({ batch, createdAt: Date.parse(batch.batch.created_at) } satisfies BatchRecord));

export async function getBatch(id: string): Promise<Batch | undefined> {
  const row = await tx<BatchRecord | undefined>([BATCHES], 'readonly', t => t.objectStore(BATCHES).get(id));
  return row?.batch;
}

export async function listBatches(): Promise<Batch[]> {
  const rows = await tx<BatchRecord[]>([BATCHES], 'readonly', t => t.objectStore(BATCHES).getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(row => row.batch);
}

export const getWindowedState = (id: string) =>
  tx<WindowedState | undefined>([WINDOWED], 'readonly', t => t.objectStore(WINDOWED).get(id));

/** Commit the recoverable snapshot and its segment outputs atomically. */
export const putWindowedProgress = (batch: Batch, state: WindowedState) =>
  tx([BATCHES, WINDOWED], 'readwrite', t => {
    t.objectStore(WINDOWED).put(state, batch.batch.batch_id);
    return t.objectStore(BATCHES).put({ batch, createdAt: Date.parse(batch.batch.created_at) } satisfies BatchRecord);
  });

/** Deletes only the batch snapshot; immutable originals and legacy rows are retained. */
export async function deleteBatch(id: string): Promise<void> {
  await tx([BATCHES, WINDOWED], 'readwrite', t => {
    t.objectStore(WINDOWED).delete(id);
    return t.objectStore(BATCHES).delete(id);
  });
}
