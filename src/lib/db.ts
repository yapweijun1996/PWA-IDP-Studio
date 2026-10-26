import type { DocumentRecord } from './types';

const DB_NAME = 'idp-studio';
const DOCS = 'documents';
const FILES = 'files';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(DOCS, { keyPath: 'id' });
      req.result.createObjectStore(FILES);
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

export const putDocument = (d: DocumentRecord) =>
  tx([DOCS], 'readwrite', (t) => t.objectStore(DOCS).put(d));

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

export async function deleteDocument(id: string): Promise<void> {
  await tx([DOCS, FILES], 'readwrite', (t) => {
    t.objectStore(FILES).delete(id);
    return t.objectStore(DOCS).delete(id);
  });
}
