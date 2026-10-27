import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { countPages, pageManifest, renderFile } from './pdf';
import { createPageSource } from './agent/pageSource';

const fake = vi.hoisted(() => {
  const render = vi.fn((_options: unknown) => ({ promise: Promise.resolve() }));
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
it('re-renders cropped PDF regions at original-page scale while bounding output size', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  const source = await createPageSource(new Blob(['pdf'], { type: 'application/pdf' }), { maxPages: 2 });
  try {
    const page = await source.render(2, { crop: { x: 0.2, y: 0.3, width: 0.2, height: 0.3 }, scale: 20, maxSide: 5000 });
    expect(page.page).toBe(2);
    expect(Math.max(page.width, page.height)).toBeLessThanOrEqual(2000);
    const args = fake.render.mock.calls[0][0] as unknown as { canvas: HTMLCanvasElement; viewport: { width: number; height: number }; transform: number[] };
    expect(args.viewport.width).toBeGreaterThan(page.width * 4);
    expect(args.viewport.height).toBeGreaterThan(page.height * 3);
    expect(args.transform[4]).toBeCloseTo(-args.viewport.width * 0.2);
    expect(args.transform[5]).toBeCloseTo(-args.viewport.height * 0.3);
    await expect(source.render(3)).rejects.toThrow(/outside/);
    await expect(source.render(1, { crop: { x: 0.9, y: 0, width: 0.2, height: 1 } })).rejects.toThrow(/crop/);
  } finally { await source.dispose(); }
});
it('reads WebP dimensions and renders its decoded bitmap without changing the original media', async () => {
  const image = { width: 320, height: 180, close: vi.fn() };
  const decode = vi.fn(async () => image);
  vi.stubGlobal('createImageBitmap', decode);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');
  const original = new Blob(['webp'], { type: 'image/webp' });
  expect(await pageManifest(original)).toEqual([{ page_number: 1, width: 320, height: 180 }]);
  expect(await renderFile(original, { maxPages: 1 })).toEqual([{ page: 1, width: 320, height: 180, data: 'AAAA', mimeType: 'image/jpeg' }]);
  expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 320, 180, 0, 0, 320, 180);
  expect(original.type).toBe('image/webp');
  expect(image.close).toHaveBeenCalledTimes(2);
});
