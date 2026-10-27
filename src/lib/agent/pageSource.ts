import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RenderedPage } from '../pdf';

/** Shared PDF loading and worker configuration for rendering and metadata reads. */
export async function openPdf(blob: Blob) {
  // PDF.js requires browser graphics globals, unlike the injected PageSource seam.
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
}
export interface Crop { x: number; y: number; width: number; height: number }
export interface TextItem { text: string; bbox: Crop }
export interface PageSource {
  pageCount: number;
  render(page: number, options?: { scale?: number; crop?: Crop; maxSide?: number }): Promise<RenderedPage>;
  textItems(page: number): Promise<TextItem[]>;
  /** Release a window's rendered images; the source itself remains usable. */
  release?(pages: RenderedPage[]): Promise<void>;
  dispose(): Promise<void>;
}

export async function releasePageImages(source: PageSource, pages: RenderedPage[]) {
  try { await source.release?.(pages); }
  finally { for (const page of pages) page.data = ''; pages.length = 0; }
}
export async function createPageSource(blob: Blob, { maxPages }: { maxPages: number }): Promise<PageSource> {
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error('maxPages must be a positive integer');
  const doc = blob.type === 'application/pdf' ? await openPdf(blob) : null;
  const image = doc ? null : await createImageBitmap(blob);
  const pageCount = Math.min(doc?.numPages ?? 1, maxPages);
  const check = (page: number) => { if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new Error('Page outside available range'); };
  return {
    pageCount,
    async render(page, options = {}) {
      check(page);
      const crop = options.crop ?? { x: 0, y: 0, width: 1, height: 1 };
      if (![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) || crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) throw new Error('Invalid normalized crop');
      const maxSide = options.maxSide ?? 2000;
      const requestedScale = options.scale ?? 3;
      if (!Number.isFinite(maxSide) || maxSide <= 0 || !Number.isFinite(requestedScale) || requestedScale <= 0) throw new Error('Invalid render size');
      const p = doc ? await doc.getPage(page) : null;
      const base = p?.getViewport({ scale: 1, rotation: 0 });
      const width = base?.width ?? image!.width;
      const height = base?.height ?? image!.height;
      const scale = Math.min(requestedScale, Math.min(2000, maxSide) / Math.max(width * crop.width, height * crop.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width * crop.width * scale));
      canvas.height = Math.max(1, Math.floor(height * crop.height * scale));
      if (p) await p.render({ canvas, viewport: p.getViewport({ scale, rotation: 0 }), transform: [1, 0, 0, 1, -crop.x * width * scale, -crop.y * height * scale] }).promise;
      else canvas.getContext('2d')!.drawImage(image!, crop.x * width, crop.y * height, crop.width * width, crop.height * height, 0, 0, canvas.width, canvas.height);
      const url = canvas.toDataURL('image/jpeg', 0.85);
      return { page, width: canvas.width, height: canvas.height, data: url.slice(url.indexOf(',') + 1), mimeType: 'image/jpeg' };
    },
    async textItems(page) {
      check(page);
      if (!doc) return [];
      const p = await doc.getPage(page);
      const vp = p.getViewport({ scale: 1, rotation: 0 });
      const content = await p.getTextContent();
      return content.items.flatMap(item => {
        if (!('str' in item) || !item.str.trim()) return [];
        const [x, y] = vp.convertToViewportPoint(item.transform[4], item.transform[5]);
        const left = Math.max(0, Math.min(1, x / vp.width));
        const top = Math.max(0, Math.min(1, (y - item.height) / vp.height));
        return [{ text: item.str, bbox: { x: left, y: top, width: Math.min(1 - left, Math.abs(item.width) / vp.width), height: Math.min(1 - top, Math.abs(item.height) / vp.height) } }];
      });
    },
    async dispose() { image?.close(); await doc?.destroy(); },
  };
}

export function restrictPageSource(source: PageSource, pages: number[]): PageSource {
  const allowed = new Set(pages);
  const check = (page: number) => { if (!allowed.has(page)) throw new Error('Page outside document'); };
  return {
    pageCount: source.pageCount,
    async render(page, options) { check(page); return source.render(page, options); },
    async textItems(page) { check(page); return source.textItems(page); },
    async dispose() {},
  };
}
