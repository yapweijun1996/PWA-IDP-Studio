import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { clearProfiles, loadProfiles, saveBatchMode } from './profiles';
import { copyJSONText, downloadJSON, serializeJSON, transactionJSONValue } from './jsonExport';

const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
beforeEach(() => { clearProfiles(); });
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); clearProfiles();
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
  else Reflect.deleteProperty(document, 'execCommand');
});

describe('JSON export', () => {
  it('preserves field order, escaping and two-space indentation without mutating data', () => {
    const value = { z: 'line\n"quoted"', a: [null, false, 2] };
    expect(serializeJSON(value)).toBe('{\n  "z": "line\\n\\"quoted\\"",\n  "a": [\n    null,\n    false,\n    2\n  ]\n}');
    expect(value).toEqual({ z: 'line\n"quoted"', a: [null, false, 2] });
  });
  it('uses the Auto document type and saved targeted profile, and refuses unknown transactions', () => {
    const batch = buildBatch(invoiceInput());
    const tx = batch.transactions[0];
    expect(transactionJSONValue(batch, tx.transaction_id)).toEqual({ document_type: 'purchase_invoice', ...tx.data });
    const profile = loadProfiles()[0];
    saveBatchMode(batch.batch.batch_id, { kind: 'targeted', profileId: profile.id }, profile);
    expect(transactionJSONValue(batch, tx.transaction_id)).toEqual(tx.data);
    expect(() => transactionJSONValue(batch, 'missing')).toThrow('Unknown transaction');
  });
  it('downloads the exact serialized text and releases the object URL', async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((value: Blob) => { blobs.push(value); return 'blob:export'; });
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('batch.json'); expect(this.href).toBe('blob:export');
    });
    const text = serializeJSON({ invoice: 'INV-1' });
    downloadJSON('batch.json', text);
    expect(click).toHaveBeenCalledOnce(); expect(blobs[0].type).toBe('application/json');
    const contents = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
      reader.readAsText(blobs[0]);
    });
    expect(contents).toBe(text);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:export');
  });
});

describe('clipboard completion', () => {
  function clipboard(writeText: (text: string) => Promise<void>, exec: () => boolean) {
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(exec) });
  }
  it('copies synchronously with the selected exact text and restores focus', async () => {
    const button = document.createElement('button'); document.body.append(button); button.focus();
    const write = vi.fn(async () => {});
    clipboard(write, () => {
      const input = document.querySelector('textarea')!;
      expect(input.value).toBe('/a~1b'); expect(input.selectionStart).toBe(0); expect(input.selectionEnd).toBe(5);
      return true;
    });
    await copyJSONText('/a~1b');
    expect(write).not.toHaveBeenCalled(); expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button); button.remove();
  });
  it('uses the modern API when legacy copy is denied or throws', async () => {
    const write = vi.fn(async () => {});
    clipboard(write, () => false); await copyJSONText('first');
    clipboard(write, () => { throw new Error('denied'); }); await copyJSONText('second');
    expect(write.mock.calls).toEqual([['first'], ['second']]);
  });
  it('rejects visibly actionable errors when both APIs refuse or are absent', async () => {
    clipboard(async () => { throw new Error('denied'); }, () => false);
    await expect(copyJSONText('value')).rejects.toThrow('Select and copy the value manually');
    vi.stubGlobal('navigator', {});
    await expect(copyJSONText('value')).rejects.toThrow('Clipboard unavailable');
    expect(document.querySelector('textarea')).toBeNull();
  });
  it('does not wait forever for an unanswered permission prompt', async () => {
    vi.useFakeTimers();
    clipboard(() => new Promise<void>(() => {}), () => false);
    const result = expect(copyJSONText('value')).rejects.toThrow('Clipboard unavailable');
    await vi.advanceTimersByTimeAsync(1000); await result;
    expect(document.querySelector('textarea')).toBeNull();
  });
});
