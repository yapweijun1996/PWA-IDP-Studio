import { DOCUMENT_TYPES, type DocumentType, type LineItem } from './types';
export { REQUIRED_FIELDS } from './standards';

export const LOW_CONFIDENCE = 0.85;
export interface ModelOutput {
  document_type: DocumentType;
  fields: { key: string; value: unknown; page: number; bbox: unknown; confidence: number }[];
  line_items: LineItem[];
}

/** Extracts the first JSON object from model text (tolerates fences / prose). */
export function parseModelJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model reply');
  return JSON.parse(text.slice(start, end + 1));
}
export function checkModelOutput(value: unknown): ModelOutput {
  if (!value || typeof value !== 'object') throw new Error('Reply is not an object');
  const v = value as Record<string, unknown>;
  const type = DOCUMENT_TYPES.includes(v.document_type as DocumentType) ? v.document_type as DocumentType : null;
  if (!type) throw new Error(`document_type must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  if (!Array.isArray(v.fields)) throw new Error('fields must be an array');
  const fields = v.fields.map((f, i) => {
    const o = f as Record<string, unknown>;
    if (!o || typeof o.key !== 'string' || !o.key) throw new Error(`fields[${i}].key missing`);
    const confidence = Number(o.confidence);
    return { key: o.key, value: o.value ?? null, page: Number.isInteger(o.page) && (o.page as number) > 0 ? o.page as number : 1, bbox: o.bbox, confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0 };
  });
  const line_items = Array.isArray(v.line_items) ? v.line_items : [];
  if (line_items.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('line_items must contain objects');
  return { document_type: type, fields, line_items: line_items as LineItem[] };
}
