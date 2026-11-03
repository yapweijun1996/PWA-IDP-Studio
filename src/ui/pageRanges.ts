/** Formats page numbers, collapsing only runs at least minRangeLength long. */
export function formatPageNumbers(numbers: readonly number[], minRangeLength = 3): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    const start = sorted[i];
    let endIndex = i;
    while (endIndex + 1 < sorted.length && sorted[endIndex + 1] === sorted[endIndex] + 1) endIndex++;
    if (endIndex - i + 1 >= minRangeLength) parts.push(`${start}–${sorted[endIndex]}`);
    else for (let j = i; j <= endIndex; j++) parts.push(String(sorted[j]));
    i = endIndex + 1;
  }
  return parts.join(', ');
}
