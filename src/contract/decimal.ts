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
/** Trim whitespace and validated thousands groups; preserve fractional precision. */
export function normalizeDecimal(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const text = String(input).trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,6})?$/.test(text)) return null;
  const clean = text.replace(/,/g, '');
  const [whole, fraction] = clean.split('.');
  const integer = BigInt(whole).toString();
  const negativeFraction = whole.startsWith('-') && integer === '0' && fraction && /[1-9]/.test(fraction);
  return `${negativeFraction ? '-' : ''}${integer}${fraction === undefined ? '' : `.${fraction}`}`;
}
