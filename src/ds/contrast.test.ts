import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const css = readFileSync(resolve(process.cwd(), 'src/ds/tokens.css'), 'utf8');
const luminance = (hex: string) => { const channels = hex.replace('#', '').match(/../g)!.map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4); return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722; };
const blocks = [...css.matchAll(/(?:^:root|:root\[data-theme="dark"\])\s*\{([^}]+)\}/gm)].map(match => Object.fromEntries([...match[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(token => [token[1], token[2]])));
const themes = { light: blocks[0], dark: { ...blocks[0], ...blocks[1] } };
describe('WCAG AA token text pairings', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    const pairs: [string, string][] = [];
    for (const foreground of ['text', 'muted', 'disabled']) for (const background of ['background', 'surface', 'surface-alt', 'selected', 'hover', 'sidebar', 'topbar']) pairs.push([foreground, background]);
    for (const foreground of ['info', 'success', 'warning', 'danger']) for (const background of ['background', 'surface']) pairs.push([foreground, background]);
    pairs.push(['primary-text', 'primary'], ['primary', 'background'], ['primary', 'surface']);
    for (const [foreground, background] of pairs) it(`${theme}: ${foreground} on ${background}`, () => { const values = [luminance(tokens[foreground]), luminance(tokens[background])].sort((a, b) => b - a); expect((values[0] + 0.05) / (values[1] + 0.05)).toBeGreaterThanOrEqual(4.5); });
  }
});
