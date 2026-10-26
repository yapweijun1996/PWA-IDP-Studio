import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export const MAX_PAGES = 6;
const MAX_SIDE = 1400;

export interface RenderedPage {
  page: number;
  width: number;
  height: number;
  /** base64 JPEG without data: prefix */
  data: string;
  mimeType: 'image/jpeg';
}

export const SUPPORTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export function isSupported(file: File): boolean {
  return SUPPORTED.includes(file.type);
}

function canvasToPage(canvas: HTMLCanvasElement, page: number): RenderedPage {
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return {
    page,
    width: canvas.width,
    height: canvas.height,
    data: url.slice(url.indexOf(',') + 1),
    mimeType: 'image/jpeg',
  };
}

function fit(w: number, h: number) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}

export async function renderFile(file: Blob): Promise<RenderedPage[]> {
  if (file.type === 'application/pdf') {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: RenderedPage[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, MAX_PAGES); i++) {
      const p = await doc.getPage(i);
      const base = p.getViewport({ scale: 1 });
      const scale = Math.min(MAX_SIDE / Math.max(base.width, base.height), 3);
      const vp = p.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await p.render({ canvas, viewport: vp }).promise;
      pages.push(canvasToPage(canvas, i));
    }
    return pages;
  }
  const bmp = await createImageBitmap(file);
  const { w, h } = fit(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return [canvasToPage(canvas, 1)];
}
