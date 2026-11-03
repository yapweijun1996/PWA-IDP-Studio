import { expect, it } from 'vitest';
import { formatPageNumbers } from './pageRanges';

it('formats missing page numbers and collapses only runs of three or more', () => {
  expect(formatPageNumbers([])).toBe('');
  expect(formatPageNumbers([3])).toBe('3');
  expect(formatPageNumbers([1, 2])).toBe('1, 2');
  expect(formatPageNumbers([1, 2, 3])).toBe('1–3');
  expect(formatPageNumbers([1, 2, 3, 5, 7, 8, 9])).toBe('1–3, 5, 7–9');
  expect(formatPageNumbers([9, 1, 3, 2, 2, 7, 8])).toBe('1–3, 7–9');
  expect(formatPageNumbers([3, 1, 2, 3, 1])).toBe('1–3');
});
