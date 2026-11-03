import type { Batch } from '../contract/types';
import { transactionView } from '../contract/view';
import { loadBatchMode } from './profiles';
import { sectionOf } from './sections';

/** Preserve contract insertion order, including profile field order, in every export. */
export const serializeJSON = (value: unknown) => JSON.stringify(value, null, 2);
export function transactionJSONValue(batch: Batch, id: string) {
  const tx = batch.transactions.find(t => t.transaction_id === id);
  if (!tx) throw new Error('Unknown transaction');
  return loadBatchMode(batch.batch.batch_id)?.profile ? tx.data : { document_type: transactionView(batch, id).documentType, ...tx.data };
}
/**
 * The same data grouped the way the review screen shows it: `document` (info fields), `rows` (the line items) and `footer`
 * (totals and charges). The flat clean JSON stays the stable contract for an ERP or API; this is an optional view of it. Field
 * values are the ones in the clean JSON, and an Auto result keeps its leading `document_type`.
 */
export function groupedJSONValue(batch: Batch, id: string) {
  const tx = batch.transactions.find(t => t.transaction_id === id);
  if (!tx) throw new Error('Unknown transaction');
  const profile = loadBatchMode(batch.batch.batch_id)?.profile;
  const { line_items, ...header } = tx.data;
  const entries = Object.entries(header);
  const inSection = (section: 'info' | 'footer') => Object.fromEntries(entries.filter(([key]) => sectionOf(key, profile) === section));
  return { ...(profile ? {} : { document_type: transactionView(batch, id).documentType }), document: inSection('info'), rows: Array.isArray(line_items) ? line_items : [], footer: inSection('footer') };
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
