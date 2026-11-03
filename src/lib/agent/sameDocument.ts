import { AUTO_HEADER_KEYS } from '../standards';
import type { ModelOutput } from '../validate';

/** The header keys that carry a document's own number: `document_no` (templates) and Auto's invoice_no, po_no, do_no … */
export const DOCUMENT_NUMBER_KEYS: readonly string[] = ['document_no', ...AUTO_HEADER_KEYS.filter(key => key.endsWith('_no'))];

/** A document number reduced to what identifies it: lower case, letters and digits only, no leading zeros (0004131999 = 4131999). */
export function normalizeDocumentNumber(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^0+/, '');
  return text.length >= 3 ? text : undefined; // "1" or "2" says nothing about which document this is
}

/** The header key that holds a document's *own* number, by type. Other numbers on it (the purchase order a delivery order refers to) say nothing about which document it is. */
const OWN_NUMBER_KEY: Partial<Record<string, string>> = { purchase_order: 'po_no', purchase_invoice: 'invoice_no', sales_invoice: 'invoice_no', sales_order: 'order_no', delivery_order: 'do_no', bank_receipt: 'receipt_no', credit_note: 'credit_note_no', payment_document: 'payment_no' };

/**
 * The number printed on a document. A template result names it `document_no`; otherwise it is the document's own number for its
 * type (`po_no` on a purchase order, `do_no` on a delivery order, never the order a delivery order refers to). Only a document of
 * unknown type falls back to the first usual key that has a value; a known type with no number of its own has none.
 */
export function documentNumber(output: Pick<ModelOutput, 'fields' | 'document_type'>): string | undefined {
  const own = OWN_NUMBER_KEY[output.document_type];
  const keys = output.document_type === 'unknown' ? DOCUMENT_NUMBER_KEYS : ['document_no', ...(own ? [own] : [])];
  for (const key of keys) {
    const value = normalizeDocumentNumber(output.fields.find(field => field.key === key)?.value);
    if (value) return value;
  }
  return undefined;
}

interface Part { pages: number[]; output: Pick<ModelOutput, 'fields' | 'document_type'>; boundary_status: 'confirmed' | 'needs_review' }

/**
 * The model decides where one document ends and the next begins, and on a scan it can invent a boundary (a 12-page purchase order
 * was split in two). Two documents that follow each other page for page and carry the same document number are almost certainly
 * one document, so the boundary between them becomes `needs_review` and a person confirms or merges them. A boundary is only ever
 * made more cautious, never less; nothing is merged, dropped or reordered here.
 */
export function withDuplicateNumberBoundaries<T extends Part>(parts: readonly T[]): T[] {
  return parts.map((part, index) => {
    const previous = parts[index - 1];
    if (!previous || previous.pages.at(-1)! + 1 !== part.pages[0]) return part;
    const number = documentNumber(part.output);
    return number && number === documentNumber(previous.output) ? { ...part, boundary_status: 'needs_review' as const } : part;
  });
}
