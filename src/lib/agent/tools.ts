import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core';
import { Type, type TSchema } from 'typebox';
import { Check } from 'typebox/value';
import type { Crop, PageSource } from './pageSource';
import type { RenderedPage } from '../pdf';
import { imageLimits } from '../providers';

export interface DecodedCode { format: string; text: string; bbox: Crop }
export type CodeDecoder = (image: RenderedPage) => Promise<DecodedCode[]>;
// Preserve schema-specific parameter inference before erasing the heterogeneous list.
function defineTool<T extends TSchema>(tool: AgentTool<T>): AgentTool<T> {
  const execute = tool.execute;
  return { ...tool, execute: async (id, params, signal, update) => {
    signal?.throwIfAborted();
    if (!Check(tool.parameters, params)) throw new Error(`Invalid arguments for ${tool.name}`);
    return execute(id, params, signal, update);
  } };
}
const text = (value: string): AgentToolResult<unknown> => ({ content: [{ type: 'text', text: value }], details: null });
const regionSchema = Type.Object({ ymin: Type.Number({ minimum: 0, maximum: 1000 }), xmin: Type.Number({ minimum: 0, maximum: 1000 }), ymax: Type.Number({ minimum: 0, maximum: 1000 }), xmax: Type.Number({ minimum: 0, maximum: 1000 }) });
type Region = { ymin: number; xmin: number; ymax: number; xmax: number };
function cropFor(r: Region): Crop {
  if (![r.ymin, r.xmin, r.ymax, r.xmax].every(n => Number.isFinite(n) && n >= 0 && n <= 1000) || r.ymax <= r.ymin || r.xmax <= r.xmin) throw new Error('Region must have positive area within 0..1000');
  return { x: r.xmin / 1000, y: r.ymin / 1000, width: (r.xmax - r.xmin) / 1000, height: (r.ymax - r.ymin) / 1000 };
}
const decode: CodeDecoder = async page => {
  // Required lazy boundary: barcode decoding must not enter the initial application bundle.
  const { MultiFormatReader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap, NotFoundException, ChecksumException, FormatException, BarcodeFormat } = await import('@zxing/library');
  const bitmap = await createImageBitmap(await (await fetch(`data:${page.mimeType};base64,${page.data}`)).blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
    for (let i = 0; i < luminance.length; i++) luminance[i] = (rgba[i * 4] + 2 * rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 4;
    try {
      const result = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(luminance, canvas.width, canvas.height))));
      const points = result.getResultPoints();
      const xs = points.map(p => p.getX() / canvas.width), ys = points.map(p => p.getY() / canvas.height);
      const x = xs.length ? Math.max(0, Math.min(1 - 1 / canvas.width, ...xs)) : 0;
      const y = ys.length ? Math.max(0, Math.min(1 - 1 / canvas.height, ...ys)) : 0;
      // A 1D decoder may report a single scanline; retain at least that pixel.
      return [{ format: BarcodeFormat[result.getBarcodeFormat()], text: result.getText(), bbox: { x, y, width: xs.length ? Math.min(1 - x, Math.max(1 / canvas.width, Math.max(...xs) - x)) : 1, height: ys.length ? Math.min(1 - y, Math.max(1 / canvas.height, Math.max(...ys) - y)) : 1 } }];
    } catch (error) { if (error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException) return []; throw error; }
  } finally { bitmap.close(); }
};

export function createExtractionTools(options: {
  source: PageSource;
  submit: (json: unknown) => void;
  maxImages?: number;
  decoder?: CodeDecoder;
  enabled?: Partial<Record<'read_text_layer' | 'crop_zoom' | 'scan_codes', boolean>>;
}): AgentTool<any>[] {
  const { source } = options;
  let images = 0;
  const limit = options.maxImages ?? imageLimits('openai').toolImages;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Image budget must be positive');
  const render = async (page: number, crop?: Crop, scale?: number, maxSide?: number, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (!Number.isInteger(page) || page < 1 || page > source.pageCount) throw new Error('Page outside available range');
    if (images >= limit) throw new Error(`Tool image budget exhausted (${limit}); submit the available evidence`);
    images++;
    const result = await source.render(page, { crop, scale, maxSide });
    signal?.throwIfAborted();
    return result;
  };
  const imageResult = (p: RenderedPage): AgentToolResult<unknown> => ({ content: [{ type: 'text', text: `Page ${p.page}; image coordinates are local to the requested region.` }, { type: 'image', data: p.data, mimeType: p.mimeType }], details: null });
  const page = Type.Integer({ minimum: 1 });
  return [
    defineTool({ name: 'get_page_image', label: 'Read page', description: 'Render an original page.', parameters: Type.Object({ page, max_side: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })) }), execute: async (_id, p, signal) => imageResult(await render(p.page, undefined, undefined, p.max_side, signal)) }),
    defineTool({ name: 'crop_zoom', label: 'Zoom region', description: 'Re-render unclear small text from the original. Region uses full-page 0..1000 coordinates.', parameters: Type.Object({ page, ...regionSchema.properties, scale: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 20 })) }), execute: async (_id, p, signal) => imageResult(await render(p.page, cropFor(p), p.scale ?? 6, undefined, signal)) }),
    defineTool({ name: 'read_text_layer', label: 'Read embedded text', description: 'Read embedded PDF text with normalized boxes, not OCR.', parameters: Type.Object({ page, region: Type.Optional(regionSchema) }), execute: async (_id, p, signal) => {
      signal?.throwIfAborted();
      if (p.page > source.pageCount) throw new Error('Page outside available range');
      const crop = p.region ? cropFor(p.region) : undefined;
      const items = (await source.textItems(p.page)).filter(i => !crop || (i.bbox.x < crop.x + crop.width && i.bbox.x + i.bbox.width > crop.x && i.bbox.y < crop.y + crop.height && i.bbox.y + i.bbox.height > crop.y));
      const lines = items.map(i => `${JSON.stringify(i.text)} [${[i.bbox.y, i.bbox.x, i.bbox.y + i.bbox.height, i.bbox.x + i.bbox.width].map(n => Math.round(n * 1000)).join(',')}]`).join('\n');
      return text(lines.length > 12000 ? lines.slice(0, 12000) + '\n[truncated]' : lines || 'No embedded text (image or scan).');
    } }),
    defineTool({ name: 'scan_codes', label: 'Scan codes', description: 'Decode visible QR/barcodes, trying the page then zoomed tiles. Use only when a code is visible or likely to encode a needed value.', parameters: Type.Object({ page, region: Type.Optional(regionSchema) }), execute: async (_id, p, signal) => {
      if (images >= limit) throw new Error(`Tool image budget exhausted (${limit})`);
      const root = p.region ? cropFor(p.region) : { x: 0, y: 0, width: 1, height: 1 };
      const crops = [root, ...[0, 0.5].flatMap(y => [0, 0.5].map(x => ({ x: root.x + x * root.width, y: root.y + y * root.height, width: root.width / 2, height: root.height / 2 })))];
      const found: DecodedCode[] = [];
      for (const crop of crops) {
        if (images >= limit) break;
        const results = await (options.decoder ?? decode)(await render(p.page, crop, 6, 2000, signal));
        for (const code of results) if (!found.some(c => c.text === code.text && c.format === code.format)) found.push({ ...code, bbox: { x: crop.x + code.bbox.x * crop.width, y: crop.y + code.bbox.y * crop.height, width: code.bbox.width * crop.width, height: code.bbox.height * crop.height } });
      }
      return text(found.length ? JSON.stringify(found).slice(0, 12000) : 'none found');
    } }),
    defineTool({ name: 'submit_result', label: 'Submit extraction', description: 'Validate the extraction JSON. Fix errors and submit again. Never approves data.', parameters: Type.Object({ json: Type.Unknown() }), execute: async (_id, p) => {
      try { options.submit(typeof p.json === 'string' ? JSON.parse(p.json) : p.json); return { ...text('Accepted for validation and human review.'), terminate: true }; }
      catch (error) { return text(`Invalid result: ${(error as Error).message}. Correct and call submit_result again.`); }
    } }),
  ].filter(tool => options.enabled?.[tool.name as 'read_text_layer' | 'crop_zoom' | 'scan_codes'] !== false || tool.name === 'get_page_image' || tool.name === 'submit_result');
}

/** Metadata is projected from the executable definitions, never maintained separately. */
export function extractionToolCatalog() {
  return createExtractionTools({
    source: { pageCount: 0, async render() { throw new Error('Catalog only'); }, async textItems() { return []; }, async dispose() {} },
    submit() {},
  }).map(({ name, description, parameters }) => ({ name, description, parameters }));
}
