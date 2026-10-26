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
it('detects duplicate bases and raw CSS values but allows token values', () => { expect(countViolations('.ds-card {font-size: 14px} .ds-card {z-index: 5}', 'src/ds/components.css')).toEqual({ 'raw-css-value': 2, 'duplicate-base-selector': 1 }); expect(countViolations('.ds-card {font-size: var(--font-body); border-radius: var(--radius-md)}', 'src/ds/components.css')).toEqual({}); });
