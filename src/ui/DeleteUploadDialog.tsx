import { useState } from 'react';
import type { Batch } from '../contract/types';
import { Button, Dialog } from '../ds';
import { deleteLocalBatch } from './storage';

/** Confirms removing one upload from this browser. The caller owns refreshing and showing the error message. */
export function DeleteUploadDialog({ batch, onClose, onDeleted, onError }: { batch?: Batch; onClose: () => void; onDeleted?: () => void | Promise<void>; onError: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  return <Dialog open={!!batch} onClose={() => !busy && onClose()} title="Delete upload?">
    <p>{batch?.source_files[0].filename} and its batch will be removed from this browser only, including its legacy source record if migrated. Originals referenced by another batch or unrelated legacy record are kept. Provider-side data is not deleted.</p>
    <Button disabled={busy} onClick={onClose}>Cancel</Button><Button variant="danger" disabled={busy} onClick={async () => { if (!batch) return; setBusy(true); try { await deleteLocalBatch(batch); await onDeleted?.(); onClose(); } catch (e) { onError(String(e)); } finally { setBusy(false); } }}>Delete</Button>
  </Dialog>;
}
