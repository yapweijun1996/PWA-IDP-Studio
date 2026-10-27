import { DOCUMENT_TYPES, type DocumentType, type LineItem } from './types';
import type { ExtractionProfile, ProfileField } from './agent/contract';
import { normalizeDecimal } from '../contract/decimal';
import { isIsoDate } from './standards';
export { REQUIRED_FIELDS } from './standards';

export const LOW_CONFIDENCE = 0.85;
export interface ModelOutput {
  document_type: DocumentType;
  fields: { key: string; value: unknown; page: number; bbox: unknown; confidence: number }[];
  line_items: (LineItem | Record<string, unknown>)[];
  requiredPointers?: string[];
  rowEvidence?: { row: number; key: string; page: number; bbox: unknown; confidence: number }[];
  includeRows?: boolean;
  fieldTypes?: Record<string, ProfileField['type']>;
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
  const rowEvidence: NonNullable<ModelOutput['rowEvidence']> = [];
  const rows = line_items.map((row, index) => Object.fromEntries(Object.entries(row).map(([key, cell]) => {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell) || !Object.hasOwn(cell, 'value')) return [key, cell];
    const metadata = cell as Record<string, unknown>;
    const confidence = Number(metadata.confidence);
    rowEvidence.push({ row: index, key, page: Number.isInteger(metadata.page) && (metadata.page as number) > 0 ? metadata.page as number : 1, bbox: metadata.bbox, confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0 });
    return [key, metadata.value ?? null];
  })));
  return { document_type: type, fields, line_items: rows, ...(rowEvidence.length ? { rowEvidence } : {}) };
}

/** Targeted output uses the same header array; row cells carry value and evidence. */
export function checkProfileOutput(value: unknown, profile: ExtractionProfile): ModelOutput {
  const output = checkModelOutput(value);
  const raw = value as Record<string, unknown>;
  const extras = Object.keys(raw).filter(k => !['document_type', 'fields', 'line_items'].includes(k));
  if (raw.line_items !== undefined && !Array.isArray(raw.line_items)) throw new Error('line_items must be an array');
  if (extras.length) throw new Error(`Unexpected keys: ${extras.join(', ')}`);
  const normalize = (field: ProfileField, value: unknown): unknown => {
    if (value === null || value === undefined || value === '') return null;
    if (field.type === 'amount' || field.type === 'quantity') {
      const n = normalizeDecimal(value);
      if (n === null) throw new Error(`${field.key}: expected decimal`);
      return n;
    }
    if (field.type === 'integer') {
      if ((typeof value !== 'number' && typeof value !== 'string') || !/^-?\d+$/.test(String(value).trim())) throw new Error(`${field.key}: expected integer`);
      const n = Number(value);
      if (!Number.isSafeInteger(n)) throw new Error(`${field.key}: expected safe integer`);
      return n;
    }
    if (field.type === 'date') {
      const date = String(value).trim().replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, '$1-$2-$3');
      if (!isIsoDate(date)) throw new Error(`${field.key}: expected ISO 8601 YYYY-MM-DD`);
      return date;
    }
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${field.key}: expected text`);
    return String(value);
  };
  const allowed = new Set(profile.fields.map(f => f.key));
  for (const f of output.fields) if (!allowed.has(f.key)) throw new Error(`Unexpected field: ${f.key}`);
  if (new Set(output.fields.map(f => f.key)).size !== output.fields.length) throw new Error('Duplicate header keys');
  output.fields = profile.fields.map(f => {
    const cell = output.fields.find(c => c.key === f.key);
    return { key: f.key, value: normalize(f, cell?.value), page: cell?.page ?? 1, bbox: cell?.bbox ?? null, confidence: cell?.confidence ?? 0 };
  });
  const pointer = (key: string) => '/' + key.replace(/~/g, '~0').replace(/\//g, '~1');
  output.requiredPointers = profile.fields.filter(f => f.required).map(f => pointer(f.key));
  output.fieldTypes = Object.fromEntries(profile.fields.map(f => [pointer(f.key), f.type]));
  output.rowEvidence = [];
  if (!profile.rowFields.length && output.line_items.length) throw new Error('Rows are not allowed by this profile');
  output.includeRows = profile.rowFields.length > 0;
  output.line_items = ((raw.line_items ?? []) as Record<string, unknown>[]).map((row, index) => {
    const record = row as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!profile.rowFields.some(f => f.key === key)) throw new Error(`Unexpected row key: ${key}`);
    return Object.fromEntries(profile.rowFields.map(f => {
      const cell = record[f.key];
      if (cell !== null && cell !== undefined && (typeof cell !== 'object' || Array.isArray(cell))) throw new Error(`${f.key}: row cell must contain value, page, bbox, confidence`);
      const metadata = cell === null || cell === undefined ? {} : cell as Record<string, unknown>;
      const evidence = checkModelOutput({ document_type: output.document_type, fields: [{ ...metadata, key: f.key }], line_items: [] }).fields[0];
      output.rowEvidence!.push({ row: index, ...evidence });
      output.fieldTypes![`/line_items/${index}${pointer(f.key)}`] = f.type;
      if (f.required) output.requiredPointers!.push(`/line_items/${index}${pointer(f.key)}`);
      return [f.key, normalize(f, evidence.value)];
    }));
  });
  return output;
}
