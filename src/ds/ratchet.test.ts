// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The zero-dependency Node script intentionally has no TypeScript declaration.
import { check, scan, countViolations } from '../../scripts/check-ssot.mjs';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
it('equal baseline passes; new raw paint and native modal fail in a temporary copy', async () => { const root = await mkdtemp(join(tmpdir(), 'idp-ssot-')); roots.push(root); await mkdir(join(root, 'src/ui'), { recursive: true }); await mkdir(join(root, 'scripts')); await writeFile(join(root, 'src/ui/Legacy.tsx'), 'export const legacy = "#abcdef";'); const baseline = await scan(root); await writeFile(join(root, 'scripts/ssot-baseline.json'), JSON.stringify(baseline)); expect(await check(root)).toEqual([]); await writeFile(join(root, 'src/ui/New.tsx'), 'export const view = <dialog style={{color: "#123456"}}>Unsafe</dialog>;'); const failures: string[] = await check(root); expect(failures.some(line => line.includes('New.tsx: raw-colour'))).toBe(true); expect(failures.some(line => line.includes('New.tsx: native-disclosure'))).toBe(true); expect(failures.some(line => line.includes('New.tsx: inline-paint'))).toBe(true); });
it('flags raw pixel sizes but allows tokens, relative units, breakpoints and non-size properties', () => {
  expect(countViolations('.ds-a {width: 44px; height: 44px; min-width: 10px; max-height: calc(100% - 24px)}', 'src/ds/components.css')).toEqual({ 'raw-size': 4 });
  expect(countViolations('.ds-a {width: var(--touch-target); max-width: 100%; width: min(100%, var(--dialog-width)); line-height: 20px; border-width: 1px}', 'src/ds/components.css')).toEqual({});
  expect(countViolations('@media (min-width: 1024px) { .ds-a {width: 100%} } @media screen and (max-width: 759px) { .ds-b {height: auto} }', 'src/ds/components.css')).toEqual({});
  expect(countViolations(':root {--touch-target: 44px; --dialog-width: 560px}', 'src/ds/tokens.css')).toEqual({});
});
it('flags native controls outside DS components only', () => {
  const source = 'export const view = <div><button>Go</button><input /><select /><textarea /><table /></div>;';
  expect(countViolations(source, 'src/ui/pages/Legacy.tsx')).toEqual({ 'native-control': 5 });
  expect(countViolations(source, 'src/ds/ComponentSheet.tsx')).toEqual({ 'native-control': 5 });
  expect(countViolations(source, 'src/ds/components/Button.tsx')).toEqual({});
  expect(countViolations('const ref = useRef<HTMLInputElement>(null);', 'src/ui/pages/Home.tsx')).toEqual({});
});
it('detects duplicate bases and raw CSS values but allows token values', () => { expect(countViolations('.ds-card {font-size: 14px} .ds-card {z-index: 5}', 'src/ds/components.css')).toEqual({ 'raw-css-value': 2, 'duplicate-base-selector': 1 }); expect(countViolations('.ds-card {font-size: var(--font-body); border-radius: var(--radius-md)}', 'src/ds/components.css')).toEqual({}); });
