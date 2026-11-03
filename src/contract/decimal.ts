const SCALE = 1_000_000n;
export function isDecimalString(s: unknown): s is string {
  return typeof s === 'string' && /^-?\d+(\.\d{1,6})?$/.test(s);
}
export function toScaled(s: string): bigint {
  if (!isDecimalString(s)) throw new TypeError('Expected a decimal string with at most six fractional digits');
  const negative = s.startsWith('-');
  const [whole, fraction = ''] = (negative ? s.slice(1) : s).split('.');
  const value = BigInt(whole) * SCALE + BigInt(fraction.padEnd(6, '0'));
  return negative ? -value : value;
}
export function sumDecimals(list: readonly string[]): string {
  const sum = list.reduce((total, s) => total + toScaled(s), 0n);
  const absolute = sum < 0n ? -sum : sum;
  const fraction = (absolute % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return `${sum < 0n ? '-' : ''}${absolute / SCALE}${fraction ? `.${fraction}` : ''}`;
}
export function decimalEquals(a: string, b: string, tolerance = '0.01'): boolean {
  const limit = toScaled(tolerance);
  if (limit < 0n) throw new RangeError('Tolerance must be non-negative');
  const difference = toScaled(a) - toScaled(b);
  return (difference < 0n ? -difference : difference) <= limit;
}
/**
 * Printed prices such as 14.90000000 carry insignificant trailing zeros. When every digit past the sixth is zero
 * the value is unchanged by dropping them (keeping at least two fractional digits); any other seven-plus digit
 * fraction would lose precision and stays invalid so a human corrects it.
 */
function dropExcessZeros(text: string): string {
  const match = /^(-?[\d,]+)\.(\d{7,})$/.exec(text);
  if (!match) return text;
  const fraction = match[2].replace(/0+$/, '').padEnd(2, '0');
  return fraction.length <= 6 ? `${match[1]}.${fraction}` : text;
}
/** Trim whitespace and validated thousands groups; preserve fractional precision. */
export function normalizeDecimal(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const text = dropExcessZeros(String(input).trim());
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(text)) return null;
  const clean = text.replace(/,/g, '');
  const [whole, fraction] = clean.split('.');
  const integer = BigInt(whole).toString();
  const negativeFraction = whole.startsWith('-') && integer === '0' && fraction && /[1-9]/.test(fraction);
  return `${negativeFraction ? '-' : ''}${integer}${fraction === undefined ? '' : `.${fraction}`}`;
}
/** A decimal string with at least `places` fractional digits, for showing money: 350.5 -> 350.50, 350 -> 350.00. */
export function padDecimals(value: string, places = 2): string {
  const [whole, fraction = ''] = value.split('.');
  return fraction.length >= places ? value : `${whole}.${fraction.padEnd(places, '0')}`;
}
