/**
 * Which header keys are footer lines, and which of those are charges or adjustments to the total. Pure and dependency-free so the
 * review screen (`sections.ts`, where a field is shown) and the totals rule (`contract/rules.ts`, what a total must add up to) read
 * the same rule from one place.
 */

/** A word in a key that says the value is a total, a charge or an adjustment printed under the rows. */
const FOOTER_WORDS = new Set(['subtotal', 'total', 'discount', 'rebate', 'shipping', 'freight', 'handling', 'surcharge', 'insurance', 'rounding', 'gst', 'vat', 'due']);
/** A last word that says the value identifies, names or dates something (tax_id, shipping_address, due_date), not a total. */
const IDENTIFIER_ENDINGS = new Set(['no', 'number', 'code', 'id', 'ref', 'date', 'name', 'address', 'terms', 'method', 'type', 'mode']);
const TAX_ENDINGS = new Set(['amount', 'total', 'fee', 'charge']);
/** Footer words for a line added to or taken off the total; a key with only totals words (grand_total, amount_due) is not one. */
const ADJUSTMENT_WORDS = new Set(['discount', 'rebate', 'shipping', 'freight', 'handling', 'surcharge', 'insurance', 'rounding', 'gst', 'vat', 'tax']);
/** Adjustment words whose value is taken off the total, whether it is printed as 45.00 or -45.00. */
const SUBTRACT_WORDS = new Set(['discount', 'rebate']);

const wordsOf = (key: string) => key.toLowerCase().split('_').filter(Boolean);

/** True for a key that says the value is a total or a charge (total_amount, subtotal_amount, tax_amount, shipping_fee, rounding …), false for identifiers that merely mention one. */
export function isFooterKey(key: string): boolean {
  const words = wordsOf(key);
  if (IDENTIFIER_ENDINGS.has(words.at(-1) ?? '')) return false;
  if (words.some(word => FOOTER_WORDS.has(word))) return true;
  return words.includes('tax') && (words.length === 1 || TAX_ENDINGS.has(words.at(-1) ?? ''));
}

/**
 * How a footer line changes the total: `add` (shipping, freight, rounding, tax, handling … as printed, so a negative rounding
 * lowers it), `subtract` (discount, rebate: their size is taken off whichever sign is printed), or undefined for anything that is not
 * a footer line or is a total itself (total_amount, subtotal_amount, amount_due).
 */
export function adjustmentOf(key: string): 'add' | 'subtract' | undefined {
  if (!isFooterKey(key)) return undefined;
  const words = wordsOf(key);
  if (!words.some(word => ADJUSTMENT_WORDS.has(word))) return undefined;
  return words.some(word => SUBTRACT_WORDS.has(word)) ? 'subtract' : 'add';
}
