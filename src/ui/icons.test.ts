import { describe, expect, it } from 'vitest';
import { ICONS } from './icons.generated';

const sources = import.meta.glob('./*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const uiFiles = import.meta.glob('./**/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('icon catalog', () => {
  for (const [name, markup] of Object.entries(ICONS)) {
    it(`${name} contains only safe SVG geometry`, () => {
      const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml');
      expect(doc.querySelector('parsererror')).toBeNull();
      for (const element of doc.querySelectorAll('*')) {
        expect(['svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']).toContain(element.localName);
        for (const attribute of element.attributes) {
          expect(attribute.name).not.toMatch(/^on|href|style/i);
          expect(attribute.value).not.toMatch(/javascript:|url\s*\(/i);
        }
      }
    });
  }

  it('resolves every literal Icon name used by the UI', () => {
    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(/<Icon\b[^>]*\bname="([^"]+)"/g)) {
        expect(Object.hasOwn(ICONS, match[1]), match[1]).toBe(true);
      }
    }
  });

  it('does not use legacy icon glyphs anywhere in the UI', () => {
    for (const [file, source] of Object.entries(uiFiles)) {
      expect(source, file).not.toMatch(/[\u2630\u2302\u2699]/u);
    }
  });
});
