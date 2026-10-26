import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from './App';
import { putBatch, putFile } from '../lib/db';
import { pageManifest, renderFile } from '../lib/pdf';
import { runExtraction } from '../lib/extract';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';

vi.mock('../lib/db', () => ({ listBatches: vi.fn(async () => []), getBatch: vi.fn(async () => undefined), putBatch: vi.fn(async () => {}), putFile: vi.fn(async () => {}) }));
vi.mock('../lib/migrateStore', () => ({ migrateStore: vi.fn(async () => ({ migrated: 0, skipped: 0 })) }));
vi.mock('../lib/pdf', () => ({ pageManifest: vi.fn(async () => [{ page_number: 1, width: 100, height: 100 }]), renderFile: vi.fn(async () => []) }));
vi.mock('../lib/hash', () => ({ sha256: vi.fn(async () => 'a'.repeat(64)) }));
vi.mock('../lib/extract', () => ({ runExtraction: vi.fn() }));
vi.mock('./UpdatePrompt', () => ({ UpdatePrompt: () => null }));
let container: HTMLDivElement;
let root: Root;
let connected: boolean;
const notice = 'You are offline. Uploads need a connection to the AI provider, so nothing was stored or sent. Your saved documents are still available.';
const drop = async () => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['png'], 'scan.png', { type: 'image/png' })] } });
  await act(async () => { container.querySelector('.ds-dropzone')!.dispatchEvent(event); });
};
beforeEach(async () => {
  vi.clearAllMocks();
  connected = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => connected);
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  window.location.hash = '#/';
  vi.mocked(runExtraction).mockResolvedValue(buildBatch(invoiceInput()));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => { root.render(createElement(App)); });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('refuses every offline drop before storage, rendering or provider access and clears on reconnect', async () => {
  connected = false; // No event: the drop must read current browser connectivity.
  await drop();
  expect(container.querySelector('.ds-notice.ds-tone-warning > span')?.textContent).toBe(notice);
  await drop();
  expect(putFile).not.toHaveBeenCalled();
  expect(putBatch).not.toHaveBeenCalled();
  expect(pageManifest).not.toHaveBeenCalled();
  expect(renderFile).not.toHaveBeenCalled();
  expect(runExtraction).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new Event('offline')); });
  connected = true;
  await act(async () => { window.dispatchEvent(new Event('online')); });
  expect(container.textContent).not.toContain(notice);
  expect(putBatch).not.toHaveBeenCalled(); // Reconnection must not queue rejected files.
});
it('accepts a fresh online drop after an offline refusal even without a connectivity event', async () => {
  connected = false;
  await drop();
  connected = true;
  await drop();
  expect(putFile).toHaveBeenCalledTimes(1);
  expect(putBatch).toHaveBeenCalledTimes(2);
  expect(runExtraction).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain(notice);
});
