import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

function baseSelectors(source) {
  const topLevel = source.replace(/@media[^{}]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  return [...topLevel.matchAll(/(?:^|})\s*([^{}]+)\{/g)].flatMap(match => match[1].split(',').map(selector => selector.trim()).filter(selector => /^\.[a-zA-Z][\w-]*$/.test(selector)));
}

/** Production source only: fixtures, tests and generated icon geometry are not UI. */
export function countViolations(source, file) {
  const counts = {};
  const count = (rule, regex) => { const total = [...source.matchAll(regex)].length; if (total) counts[rule] = total; };
  if (file !== 'src/ds/tokens.css' && !file.endsWith('icons.generated.ts')) count('raw-colour', /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\s*\(/gi);
  if (file.endsWith('.css') && file !== 'src/ds/tokens.css') {
    count('raw-css-value', /\b(?:border(?:-[\w]+)?-radius|box-shadow|font-size)\s*:[^;{}]*\b\d*\.?\d+px\b|\bz-index\s*:\s*-?\d+\b/gim);
    const seen = new Set();
    let duplicates = 0;
    // Base class definitions only; state, descendant and responsive overrides are intentional.
    for (const selector of baseSelectors(source)) { if (seen.has(selector)) duplicates++; seen.add(selector); }
    if (duplicates) counts['duplicate-base-selector'] = duplicates;
  }
  if (/\.[jt]sx?$/.test(file) && !file.endsWith('icons.generated.ts')) {
    count('native-disclosure', /<(?:details|summary|dialog)\b/g);
    if (file !== 'src/ui/Icon.tsx') count('raw-svg', /<svg\b/g);
    count('inline-paint', /style\s*=\s*\{\{[^}]*\b(?:color|background\w*|border\w*)\s*:/gs);
  }
  return counts;
}
export async function scan(root) {
  const result = {};
  const owners = new Map();
  async function visit(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (/\.(?:css|tsx?|jsx?)$/.test(entry.name) && !/\.(?:test|spec)\./.test(entry.name)) {
        const file = relative(root, path).split('\\').join('/');
        const source = await readFile(path, 'utf8');
        const counts = countViolations(source, file);
        if (file.endsWith('.css')) for (const selector of new Set(baseSelectors(source))) {
          if (owners.has(selector) && owners.get(selector) !== file) counts['duplicate-base-selector'] = (counts['duplicate-base-selector'] ?? 0) + 1;
          else owners.set(selector, file);
        }
        if (Object.keys(counts).length) result[file] = counts;
      }
    }
  }
  await visit(resolve(root, 'src'));
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
/** Returns all per-file regressions; absent baseline entries have allowance zero. */
export function compare(current, baseline) {
  const failures = [];
  for (const [file, counts] of Object.entries(current)) for (const [rule, count] of Object.entries(counts)) {
    const allowed = baseline[file]?.[rule] ?? 0;
    if (count > allowed) failures.push(`${file}: ${rule} ${count} exceeds baseline ${allowed}`);
  }
  return failures;
}
export async function check(root) {
  const baseline = JSON.parse(await readFile(resolve(root, 'scripts/ssot-baseline.json'), 'utf8'));
  return compare(await scan(root), baseline);
}
if (typeof process !== 'undefined' && process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
  const failures = await check(root);
  if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
  else console.log('SSOT ratchet passed. Lower baseline counts when removing legacy violations.');
}
