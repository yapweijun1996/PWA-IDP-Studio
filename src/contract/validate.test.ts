import { describe, expect, it } from 'vitest';
import fixture from '../../docs/contract-v2/sample-100-pages-20-transactions.json';
import edgeFixture from '../../docs/contract-v2/sample-100-pages-22-transactions-edge-cases.json';
import type { Batch, IssueScope } from './types';
import { exportEligibleTransactions, validateBatch } from './validate';

function mutate(fn: (batch: Batch) => void): Batch {
  const batch = structuredClone(fixture) as Batch;
  fn(batch);
  return batch;
}
function issue(batch: Batch, scope: IssueScope, target_id: string) {
  batch.issues.push({ issue_id: 'test_issue', scope, target_id, rule_code: 'TEST', severity: 'blocking', message: 'Test blocker', status: 'open', waiver_review_id: null });
}
const mutations: [string, (b: Batch) => void][] = [
  ['DUPLICATE_FILE_ID', b => { b.source_files.push(structuredClone(b.source_files[0])); }],
  ['DUPLICATE_PAGE', b => { b.pages.push(structuredClone(b.pages[0])); }],
  ['PAGE_MANIFEST_COVERAGE', b => { b.pages.pop(); }],
  ['UNKNOWN_PAGE_SOURCE', b => { b.pages[0].file_id = 'missing'; }],
  ['UNEXPLAINED_UNASSIGNED_PAGE', b => { b.pages[0].regions = []; }],
  ['DUPLICATE_REGION', b => { b.pages[0].regions.push(structuredClone(b.pages[0].regions[0])); }],
  ['REGION_BBOX_OUT_OF_RANGE', b => { b.pages[0].regions[0].bbox.x = 0.5; }],
  ['DUPLICATE_DOCUMENT_ID', b => { b.documents.push(structuredClone(b.documents[0])); }],
  ['DUPLICATE_TRANSACTION_ID', b => { b.transactions.push(structuredClone(b.transactions[0])); }],
  ['DUPLICATE_EVIDENCE_ID', b => { b.evidence.push(structuredClone(b.evidence[0])); }],
  ['INVALID_DOCUMENT_PAGE_REF', b => { b.documents[0].page_refs[0].region_id = 'missing'; }],
  ['INVALID_DOCUMENT_TRANSACTION_REF', b => { b.documents[0].transaction_ids[0] = 'missing'; }],
  ['ORPHAN_TRANSACTION', b => { b.transactions[0].document_id = 'missing'; }],
  ['INVALID_FIELD_EVIDENCE', b => { b.transactions[0].field_evidence['/missing'] = ['missing']; }],
  ['ORPHAN_EVIDENCE', b => { b.evidence[0].transaction_id = 'missing'; }],
  ['EVIDENCE_SOURCE_OUTSIDE_DOCUMENT', b => { b.evidence[0].sources[0].page_number = 101; }],
  ['EVIDENCE_BBOX_OUT_OF_RANGE', b => { b.evidence[0].sources[0].bbox = { x: 0.5, y: 0, width: 1, height: 1 }; }],
  ['ORPHAN_ISSUE', b => { issue(b, 'document', 'missing'); }],
  ['INELIGIBLE_TRANSACTION', b => { b.transactions[0].status = 'draft'; }],
  ['UNCONFIRMED_BOUNDARY', b => { b.documents[0].boundary_status = 'needs_review'; }],
  ['BLOCKING_ISSUE', b => { issue(b, 'transaction', b.transactions[0].transaction_id); }],
  ['EVIDENCE_POINTER_UNRESOLVED', b => { b.evidence[0].field_pointer = '/missing'; }],
  ['ISSUE_TARGET_UNKNOWN', b => { issue(b, 'page', 'missing:1'); }],
];
describe('validateBatch', () => {
  it.each([[fixture, 19], [edgeFixture, 21]] as const)('validates fixture with %s', (data, count) => {
    expect(validateBatch(data)).toEqual({ ok: true, errors: [], warnings: [] });
    const ids = exportEligibleTransactions(data as Batch);
    expect(ids).toEqual(data.validation.export_eligible_transaction_ids);
    expect(ids).toHaveLength(count);
  });
  it.each(mutations)('reports %s', (code, fn) => {
    const result = validateBatch(mutate(fn));
    expect(result.ok).toBe(false);
    expect(result.errors.map(e => e.code)).toContain(code);
    expect(result.errors.map(e => e.code)).not.toContain('SCHEMA');
  });
  it('warns DUPLICATE_BUSINESS_KEY_CANDIDATE without blocking', () => {
    const data = mutate(b => { b.transactions[9].business_key = b.transactions[0].business_key; });
    const result = validateBatch(data);
    expect(result.ok).toBe(true);
    expect(result.warnings).toContainEqual({ code: 'DUPLICATE_BUSINESS_KEY_CANDIDATE', message: data.transactions[9].transaction_id, severity: 'warning' });
  });
  it('collects structural errors and short-circuits semantic validation', () => {
    const result = validateBatch({ schema_version: 'wrong' });
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    expect(result.errors.every(e => e.code === 'SCHEMA')).toBe(true);
  });
  it.each(['file', 'evidence'] as const)('rejects unknown %s issue targets', scope => {
    expect(validateBatch(mutate(b => issue(b, scope, 'missing'))).errors.map(e => e.code)).toContain('ISSUE_TARGET_UNKNOWN');
  });
  it('resolves escaped pointers, arrays, null and the root without inherited properties', () => {
    const data = mutate(b => { b.transactions[0].data = { 'a/b': { '~key': [null] } }; });
    for (const pointer of ['', '/a~1b/~0key/0']) {
      for (const ev of data.evidence.filter(e => e.transaction_id === data.transactions[0].transaction_id)) ev.field_pointer = pointer;
      expect(validateBatch(data).errors.map(e => e.code)).not.toContain('EVIDENCE_POINTER_UNRESOLVED');
    }
    for (const pointer of ['/toString', '/a~1b/~0key/01', '/a~1b/~0key/-', '/a~1b/~0key/1']) {
      data.evidence[0].field_pointer = pointer;
      expect(validateBatch(data).errors.map(e => e.code)).toContain('EVIDENCE_POINTER_UNRESOLVED');
    }
  });
});
describe('exportEligibleTransactions', () => {
  it.each(['batch', 'document', 'transaction', 'page'] as const)('recomputes %s blockers despite stored eligibility', scope => {
    const data = mutate(b => {
      const doc = b.documents[0];
      const ref = doc.page_refs[0];
      const target = { batch: b.batch.batch_id, document: doc.document_id, transaction: b.transactions[0].transaction_id, page: `${ref.file_id}:${ref.page_number}` };
      issue(b, scope, target[scope]);
    });
    const id = data.transactions[0].transaction_id;
    expect(exportEligibleTransactions(data)).not.toContain(id);
    expect(validateBatch(data).errors.map(e => e.code)).toContain('BLOCKING_ISSUE');
    data.issues[data.issues.length - 1].status = 'resolved';
    expect(exportEligibleTransactions(data)).toContain(id);
    data.issues[data.issues.length - 1].status = 'waived';
    expect(exportEligibleTransactions(data)).toContain(id);
  });
  it('ignores stored eligibility and rejects missing documents without throwing', () => {
    const data = mutate(b => { b.validation.export_eligible_transaction_ids = []; });
    expect(exportEligibleTransactions(data)).toEqual(fixture.validation.export_eligible_transaction_ids);
    data.transactions[0].document_id = 'missing';
    expect(exportEligibleTransactions(data)).not.toContain(data.transactions[0].transaction_id);
  });
});
