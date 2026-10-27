import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { RULE_CATALOG, ruleCatalogEntry } from './ruleCatalog';

const sources = import.meta.glob(['./**/*.ts', '../lib/**/*.ts', '!./**/*.test.ts', '!../lib/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
describe('rule catalog coverage', () => {
  it('covers emitted literal codes throughout contract and lib', () => {
    const missing: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.endsWith('/ruleCatalog.ts')) continue;
      const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
      const check = (node: ts.Node) => {
        if (ts.isStringLiteralLike(node) && /^[A-Z][A-Z0-9_]+$/.test(node.text) && !ruleCatalogEntry(node.text)) missing.push(`${path}: ${node.text}`);
      };
      const visit = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && ['rule_code', 'code'].includes(node.name.getText(file).replace(/['"]/g, ''))) check(node.initializer);
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'add') node.arguments.forEach(check);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    expect(missing).toEqual([]);
    expect(new Set(RULE_CATALOG.map(r => r.code)).size).toBe(RULE_CATALOG.length);
  });
  it('allows semantic review exceptions but never integrity or extraction bypasses', () => {
    expect(RULE_CATALOG.filter(r => r.waivable).map(r => r.code).sort()).toEqual([
      'FIELD_WITHOUT_EVIDENCE', 'LOW_CONFIDENCE', 'TOTALS_MISMATCH',
    ]);
    expect(ruleCatalogEntry('TOTALS_MISMATCH')).toMatchObject({ scope: 'transaction', severity: 'blocking', autoResolves: true, waivable: true });
    expect(ruleCatalogEntry('MISSING_REQUIRED')).toMatchObject({ severity: 'blocking', autoResolves: true, waivable: false });
    expect(ruleCatalogEntry('ORPHAN_TRANSACTION')).toMatchObject({ waivable: false, autoResolves: false });
    expect(ruleCatalogEntry('UNRECOGNIZED_RULE')).toBeUndefined();
  });
});
