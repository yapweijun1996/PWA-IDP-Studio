import { normalizeWireBox } from './bbox';
import {
  DOCUMENT_TYPES,
  type DocumentType,
  type Envelope,
  type Evidence,
  type LineItem,
  type Validation,
} from './types';

export const REQUIRED_FIELDS: Record<DocumentType, string[]> = {
  purchase_invoice: ['supplier_name', 'invoice_no', 'invoice_date', 'currency', 'total_amount'],
  sales_order: ['customer_name', 'order_no', 'order_date', 'currency', 'total_amount'],
  purchase_order: ['supplier_name', 'po_no', 'po_date', 'currency', 'total_amount'],
  bank_receipt: ['payer_name', 'receipt_no', 'receipt_date', 'currency', 'amount'],
  credit_note: ['supplier_name', 'credit_note_no', 'credit_note_date', 'currency', 'total_amount'],
  payment_document: ['payee_name', 'payment_no', 'payment_date', 'currency', 'amount'],
  other: [],
};

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
  const type = DOCUMENT_TYPES.includes(v.document_type as DocumentType)
    ? (v.document_type as DocumentType)
    : null;
  if (!type) throw new Error(`document_type must be one of: ${DOCUMENT_TYPES.join(', ')}`);
  if (!Array.isArray(v.fields)) throw new Error('fields must be an array');
  const fields = v.fields.map((f, i) => {
    const o = f as Record<string, unknown>;
    if (!o || typeof o.key !== 'string' || !o.key) throw new Error(`fields[${i}].key missing`);
    const confidence = Number(o.confidence);
    return {
      key: o.key,
      value: o.value ?? null,
      page: Number.isInteger(o.page) && (o.page as number) > 0 ? (o.page as number) : 1,
      bbox: o.bbox,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
    };
  });
  const line_items = Array.isArray(v.line_items) ? (v.line_items as LineItem[]) : [];
  return { document_type: type, fields, line_items };
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x.replace(/[, ]/g, '')) : (x as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

export function totalsMatch(extraction: Envelope['extraction']): boolean | null {
  const total = num(extraction.total_amount);
  const items = extraction.line_items;
  if (total === null || !items?.length) return null;
  const sum = items.reduce((s, it) => s + (num(it.amount) ?? 0), 0);
  return Math.abs(sum - total) < 0.01;
}

export function validate(
  type: DocumentType,
  extraction: Envelope['extraction'],
  evidence: Record<string, Evidence>,
): Validation {
  const missing_required = REQUIRED_FIELDS[type].filter((k) => {
    const v = extraction[k];
    return v === null || v === undefined || v === '';
  });
  const low_confidence = Object.entries(evidence)
    .filter(([, e]) => e.confidence < LOW_CONFIDENCE)
    .map(([k]) => k);
  const totals_match = totalsMatch(extraction);
  return {
    schema_valid: true,
    totals_match,
    missing_required,
    low_confidence,
    needs_review: missing_required.length > 0 || low_confidence.length > 0 || totals_match === false,
  };
}

/** Builds the envelope from checked model output. The AI never sets `approved`. */
export function buildEnvelope(
  documentId: string,
  out: ModelOutput,
  model: Envelope['model'],
): Envelope {
  const extraction: Envelope['extraction'] = {};
  const evidence: Record<string, Evidence> = {};
  for (const f of out.fields) {
    const n = typeof f.value === 'string' ? num(f.value) : null;
    const numeric = /(amount|price|total|quantity)/.test(f.key) && n !== null;
    extraction[f.key] = numeric ? n : f.value;
    evidence[f.key] = { page: f.page, bbox: normalizeWireBox(f.bbox), confidence: f.confidence };
  }
  extraction.line_items = out.line_items;
  const validation = validate(out.document_type, extraction, evidence);
  return {
    schema_version: '1.0',
    document_id: documentId,
    document_type: out.document_type,
    status: validation.needs_review ? 'review_required' : 'ready',
    extraction,
    evidence,
    validation,
    model,
    audit: [{ at: new Date().toISOString(), action: 'extracted' }],
  };
}

/** Clean business JSON: business fields only, no evidence. */
export function cleanJson(e: Envelope) {
  return { document_type: e.document_type, ...e.extraction };
}
