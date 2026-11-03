// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Vitest stubs CSS imports, so read the stylesheet directly. These guard layout rules jsdom cannot compute.
const css = readFileSync(resolve(process.cwd(), 'src/ds/components.css'), 'utf8');
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\>]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

it('form controls draw their boundary with the 3:1 control-border token', () => {
  for (const selector of ['.ds-button', '.ds-input', '.ds-segmented label', '.ds-tabs button', '.ds-dropzone']) expect(rule(selector), selector).toContain('var(--control-border)');
});
it('keyboard focus is kept clear of the sticky topbar and scroll-to-top button', () => {
  expect(rule('html')).toMatch(/scroll-padding-top:[^;]*var\(--topbar-height\)/);
  expect(rule('html')).toMatch(/scroll-padding-bottom:[^;]*var\(--touch-target\)/);
});
it('the sidebar never hides links: it scrolls in the phone drawer and unsticks on short desktop windows', () => {
  expect(css).toMatch(/@media \(max-width: 759px\) \{[\s\S]*\.ds-sidebar \{[^}]*overflow-y: auto/);
  expect(css).toMatch(/@media \(min-width: 760px\) and \(max-height: 560px\) \{\s*\.ds-sidebar \{[^}]*position: static/);
});
it('the sheet gap is the only section spacing', () => {
  expect(rule('.ds-sheet > .ds-page-header')).toContain('margin-bottom: 0');
  expect(css).toMatch(/\.ds-sheet > p, \.ds-page-header p \{ margin: 0; \}/);
});
