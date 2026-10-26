import type { BBox } from './types';

/**
 * Wire format asked from every model: [ymin, xmin, ymax, xmax] as integers 0..1000
 * (Gemini's native box format). Converts to the envelope format [x0, y0, x1, y1] in 0..1.
 * Returns null for malformed or degenerate boxes.
 */
export function normalizeWireBox(raw: unknown): BBox | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const n = raw.map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = n.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  if (xmax <= xmin || ymax <= ymin) return null;
  return [xmin, ymin, xmax, ymax];
}
