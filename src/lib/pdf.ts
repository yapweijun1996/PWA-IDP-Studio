import { createPageSource, openPdf } from './agent/pageSource';

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

export async function renderFile(file: Blob, { maxPages }: { maxPages: number }): Promise<RenderedPage[]> {
  const source = await createPageSource(file, { maxPages });
  try {
    const pages: RenderedPage[] = [];
    for (let page = 1; page <= source.pageCount; page++) pages.push(await source.render(page, { maxSide: 1400, scale: file.type === 'application/pdf' ? 3 : 1 }));
    return pages;
  } finally { await source.dispose(); }
}

export async function countPages(blob: Blob): Promise<number> {
  if (blob.type !== 'application/pdf') return 1;
  const doc = await openPdf(blob);
  try { return doc.numPages; } finally { await doc.destroy(); }
}

/** Physical, unrotated dimensions for every page, independent of the AI image limit. */
export async function pageManifest(blob: Blob): Promise<{ page_number: number; width: number; height: number }[]> {
  if (blob.type !== 'application/pdf') {
    const image = await createImageBitmap(blob);
    try { return [{ page_number: 1, width: image.width, height: image.height }]; }
    finally { image.close(); }
  }
  const doc = await openPdf(blob);
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
