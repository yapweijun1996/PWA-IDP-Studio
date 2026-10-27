import type { Batch } from '../contract/types';
import { transactionView } from '../contract/view';
import { loadBatchMode } from './profiles';

/** Preserve contract insertion order, including profile field order, in every export. */
export const serializeJSON = (value: unknown) => JSON.stringify(value, null, 2);
export function transactionJSONValue(batch: Batch, id: string) {
  const tx = batch.transactions.find(t => t.transaction_id === id);
  if (!tx) throw new Error('Unknown transaction');
  return loadBatchMode(batch.batch.batch_id)?.profile ? tx.data : { document_type: transactionView(batch, id).documentType, ...tx.data };
}
export async function copyJSONText(text: string) {
  const previous = document.activeElement;
  const input = document.createElement('textarea');
  input.value = text; input.setAttribute('aria-label', 'Copy JSON fallback');
  document.body.append(input); input.select();
  try {
    // Try while the click still has user activation; a permission prompt can
    // otherwise leave writeText pending indefinitely in unattended browsers.
    if (document.execCommand?.('copy')) return;
  } catch { /* Fall through to the modern clipboard API. */ }
  finally { input.remove(); if (previous instanceof HTMLElement) previous.focus(); }
  let timer: number | undefined;
  try {
    await Promise.race([
      navigator.clipboard.writeText(text),
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('Clipboard permission did not respond.')), 1000); }),
    ]);
  } catch {
    throw new Error('Clipboard unavailable. Select and copy the value manually.');
  } finally { clearTimeout(timer); }
}
export function downloadJSON(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
