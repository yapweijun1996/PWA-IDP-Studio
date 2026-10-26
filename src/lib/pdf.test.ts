import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { countPages, pageManifest, renderFile } from './pdf';

const fake = vi.hoisted(() => {
  const render = vi.fn(() => ({ promise: Promise.resolve() }));
  const getPage = vi.fn(async () => ({ getViewport: ({ scale, rotation }: { scale: number; rotation?: number }) => ({ width: 595 * scale, height: 842 * scale, rotation }), render }));
  const destroy = vi.fn(async () => {});
  return { render, getPage, destroy, doc: { numPages: 30, getPage, destroy } };
});
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(fake.doc) }) }));
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('Blob', NodeBlob); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('counts all PDF pages without rendering', async () => {
  expect(await countPages(new Blob(['pdf'], { type: 'application/pdf' }))).toBe(30);
  expect(fake.getPage).not.toHaveBeenCalled();
  expect(fake.render).not.toHaveBeenCalled();
  expect(fake.destroy).toHaveBeenCalledOnce();
});
it('gets every physical page dimension independently of the rendering limit', async () => {
  const manifest = await pageManifest(new Blob(['pdf'], { type: 'application/pdf' }));
  expect(manifest).toHaveLength(30);
  expect(manifest[29]).toEqual({ page_number: 30, width: 595, height: 842 });
  expect(fake.render).not.toHaveBeenCalled();
});
it('renders only the configured prefix, preserving original page numbers', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  const pages = await renderFile(new Blob(['pdf'], { type: 'application/pdf' }), { maxPages: 20 });
  expect(pages.map(p => p.page)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(fake.render).toHaveBeenCalledTimes(20);
  expect(fake.destroy).toHaveBeenCalledOnce();
});
