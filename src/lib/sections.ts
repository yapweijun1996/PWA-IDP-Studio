import type { ExtractionProfile, FieldType } from './agent/contract';

/** A document is shown and exported in three blocks: info at the top, the rows, and the footer totals. Row Data is the rows themselves. */
export type Section = 'info' | 'footer';
export const SECTION_LABELS: Record<Section, string> = { info: 'Document info', footer: 'Footer' };

/** A word in a key that says the value is a total, a charge or an adjustment printed under the rows. */
const FOOTER_WORDS = new Set(['subtotal', 'total', 'discount', 'shipping', 'freight', 'rounding', 'gst', 'vat', 'due']);
/** A last word that says the value identifies, names or dates something (tax_id, shipping_address, due_date), not a total. */
const IDENTIFIER_ENDINGS = new Set(['no', 'number', 'code', 'id', 'ref', 'date', 'name', 'address', 'terms', 'method', 'type', 'mode']);
const TAX_ENDINGS = new Set(['amount', 'total', 'fee', 'charge']);

/**
 * The block a header field belongs to when nobody chose one: footer for totals and charges (total_amount, subtotal_amount,
 * tax_amount, shipping_fee, discount_amount, rounding, gst_amount, amount_due …), info for everything else, including
 * identifiers that merely mention one (tax_id, shipping_address, due_date). A declared date type is always info.
 */
export function defaultSection(key: string, type?: FieldType): Section {
  if (type === 'date') return 'info';
  const words = key.toLowerCase().split('_').filter(Boolean);
  const last = words.at(-1) ?? '';
  if (IDENTIFIER_ENDINGS.has(last)) return 'info';
  if (words.some(word => FOOTER_WORDS.has(word))) return 'footer';
  if (words.includes('tax') && (words.length === 1 || TAX_ENDINGS.has(last))) return 'footer';
  return 'info';
}

/** The block of a header field: the template's explicit choice, else the default for its key. Without a template, the default. */
export function sectionOf(key: string, profile?: Pick<ExtractionProfile, 'fields'>): Section {
  const field = profile?.fields.find(f => f.key === key);
  return field?.section ?? defaultSection(key, field?.type);
}
