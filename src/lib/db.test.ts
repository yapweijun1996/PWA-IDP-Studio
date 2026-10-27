import 'fake-indexeddb/auto';
import { beforeEach, expect, it } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { deleteBatch, getBatch, getWindowedState, putWindowedProgress, type WindowedState } from './db';
import { clearLocalData, deleteLocalBatch } from '../ui/storage';

beforeEach(async () => { await clearLocalData(); });
const state: WindowedState = {
  plan: { pageCount: 1, windows: [], segments: [{ pages: [1], document_type: 'purchase_invoice', boundary_status: 'confirmed', confidence: 1 }], failed: [], unassigned: [] },
  results: [{ pages: [1], output: { document_type: 'purchase_invoice', fields: [], line_items: [] } }],
};
it('restores the matching batch and outputs, replaces failed results and isolates batch deletion', async () => {
  const input = invoiceInput(); input.batchId = 'recoverable';
  const batch = buildBatch(input);
  await putWindowedProgress(batch, { ...state, results: [{ pages: [1], output: null, error: 'failed' }] });
  expect((await getWindowedState('recoverable'))?.results[0].error).toBe('failed');
  await putWindowedProgress(batch, state);
  expect(await getBatch('recoverable')).toEqual(batch);
  expect(await getWindowedState('recoverable')).toEqual(state);
  input.batchId = 'other';
  await putWindowedProgress(buildBatch(input), state);
  await deleteBatch('recoverable');
  expect(await getBatch('recoverable')).toBeUndefined();
  expect(await getWindowedState('recoverable')).toBeUndefined();
  expect(await getWindowedState('other')).toEqual(state);
});
it('removes sidecars through UI deletion and storage clearing', async () => {
  const batch = buildBatch(invoiceInput());
  await putWindowedProgress(batch, state);
  await deleteLocalBatch(batch);
  expect(await getWindowedState(batch.batch.batch_id)).toBeUndefined();
  await putWindowedProgress(batch, state);
  await clearLocalData();
  expect(await getBatch(batch.batch.batch_id)).toBeUndefined();
  expect(await getWindowedState(batch.batch.batch_id)).toBeUndefined();
});
