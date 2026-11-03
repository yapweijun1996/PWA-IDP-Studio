import type { ExtractionProfile, FieldType } from './agent/contract';
import { isFooterKey } from './footerLines';

/** A document is shown and exported in three blocks: info at the top, the rows, and the footer totals. Row Data is the rows themselves. */
export type Section = 'info' | 'footer';
export const SECTION_LABELS: Record<Section, string> = { info: 'Document info', footer: 'Footer' };

/**
 * The block a header field belongs to when nobody chose one: footer for totals and charges (total_amount, subtotal_amount,
 * tax_amount, shipping_fee, discount_amount, rounding, gst_amount, amount_due …), info for everything else, including
 * identifiers that merely mention one (tax_id, shipping_address, due_date). A declared date type is always info.
 */
export function defaultSection(key: string, type?: FieldType): Section {
  if (type === 'date') return 'info';
  return isFooterKey(key) ? 'footer' : 'info';
}

/** The block of a header field: the template's explicit choice, else the default for its key. Without a template, the default. */
export function sectionOf(key: string, profile?: Pick<ExtractionProfile, 'fields'>): Section {
  const field = profile?.fields.find(f => f.key === key);
  return field?.section ?? defaultSection(key, field?.type);
}
