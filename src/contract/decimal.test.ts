import { describe, expect, it } from 'vitest';
import { decimalEquals, isDecimalString, normalizeDecimal, sumDecimals, toScaled } from './decimal';

describe('decimal helpers', () => {
  it('adds without binary floating-point error', () => {
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    expect(sumDecimals(['9007199254740993.000001', '0.000001'])).toBe('9007199254740993.000002');
    expect(sumDecimals([])).toBe('0');
  });
  it('handles negatives and cancellation', () => {
    expect(toScaled('-1.000001')).toBe(-1000001n);
    expect(sumDecimals(['-2', '0.5'])).toBe('-1.5');
    expect(sumDecimals(['-0.1', '0.1'])).toBe('0');
    expect(normalizeDecimal('-0.0100')).toBe('-0.0100');
  });
  it('uses inclusive exact tolerance', () => {
    expect(decimalEquals('1', '1.01')).toBe(true);
    expect(decimalEquals('1', '1.010001')).toBe(false);
    expect(decimalEquals('-1.01', '-1')).toBe(true);
    expect(decimalEquals('0.1', '0.100000', '0')).toBe(true);
    expect(() => decimalEquals('1', '1', '-0.01')).toThrow(RangeError);
  });
  it.each(['1e3', '', 'abc', '1,28.0', 'SGD 1,280.00', '1.1234567', '+1', '.1', '1.'])('rejects unclean decimal %s', input => {
    expect(isDecimalString(input)).toBe(false);
    expect(normalizeDecimal(input)).toBeNull();
    expect(() => toScaled(input)).toThrow(TypeError);
  });
  it.each([['1,280.00', '1280.00'], [' 1280 ', '1280'], ['001280.00', '1280.00'], [1280, '1280'], [-0.25, '-0.25']] as const)('normalizes %s preserving precision', (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });
  it.each([null, undefined, {}, true, Infinity, NaN, 1e21])('rejects non-decimal input %s', input => {
    expect(normalizeDecimal(input)).toBeNull();
  });
});
