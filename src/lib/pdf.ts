import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_SIDE = 1400;

export interface RenderedPage {
  page: number;
  width: number;
  height: number;
  /** base64 JPEG without data: prefix */
  data: string;
  mimeType: 'image/jpeg';
}

export const SUPPORTED = ['application/pdf', 'image/png', 'image/jpeg'];

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

export async function renderFile(file: Blob, { maxPages }: { maxPages: number }): Promise<RenderedPage[]> {
  if (file.type === 'application/pdf') {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: RenderedPage[] = [];
    try {
    for (let i = 1; i <= Math.min(doc.numPages, Math.max(1, Math.floor(maxPages))); i++) {
      const p = await doc.getPage(i);
      const base = p.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(MAX_SIDE / Math.max(base.width, base.height), 3);
      const vp = p.getViewport({ scale, rotation: 0 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      await p.render({ canvas, viewport: vp }).promise;
      pages.push(canvasToPage(canvas, i));
    }
    return pages;
    } finally { await doc.destroy(); }
  }
  const bmp = await createImageBitmap(file);
  const { w, h } = fit(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return [canvasToPage(canvas, 1)];
}

export async function countPages(blob: Blob): Promise<number> {
  if (blob.type !== 'application/pdf') return 1;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try { return doc.numPages; } finally { await doc.destroy(); }
}

/** Physical, unrotated dimensions for every page, independent of the AI image limit. */
export async function pageManifest(blob: Blob): Promise<{ page_number: number; width: number; height: number }[]> {
  if (blob.type !== 'application/pdf') {
    const image = await createImageBitmap(blob);
    try { return [{ page_number: 1, width: image.width, height: image.height }]; }
    finally { image.close(); }
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1, rotation: 0 });
      pages.push({ page_number: n, width: viewport.width, height: viewport.height });
    }
    return pages;
  } finally { await doc.destroy(); }
}
