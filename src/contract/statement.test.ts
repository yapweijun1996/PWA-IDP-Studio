import { describe, expect, it } from 'vitest';
import fixture from '../../docs/contract-v2/sample-100-pages-22-transactions-edge-cases.json';
import { buildBatch, buildBatchFromSegments, type BuildInput } from './build';
import { invoiceInput } from './fixtures';
import { validateBatch, exportEligibleTransactions } from './validate';
import { recomputeIssues } from './review';
import { assignPage, splitDocument, mergeDocuments } from './layout';
import { checkModelOutput, checkProfileOutput } from '../lib/validate';
import { exportProfiles, parseProfileImport, validateProfile } from '../lib/profiles';
import type { ExtractionProfile } from '../lib/agent/contract';
import type { Batch } from './types';

function statement(count: number): BuildInput {
  return { ...invoiceInput(), output: {
    document_type: 'statement',
    fields: [{ key: 'closing_balance', value: '1,040.00', page: 1, bbox: [10, 10, 100, 100], confidence: 1 }],
    line_items: Array.from({ length: count }, (_, i) => ({ date: '2026-10-27', description: `Entry ${i + 1}`, amount: '1,000.00', balance: '1040.00' })),
    rowEvidence: Array.from({ length: count }, (_, row) => ({ row, key: 'amount', page: 1, bbox: [100, 100, 200, 200], confidence: 1 })),
  } };
}
const blockers = (batch: Batch) => batch.issues.filter(i => i.status === 'open' && i.severity === 'blocking');

describe('statement entries', () => {
  it.each([0, 1, 40])('builds a header and %i independent entries without changing model output', count => {
    const input = statement(count), original = structuredClone(input.output);
    const batch = buildBatch(input);
    const ids = ['t_1', ...Array.from({ length: count }, (_, i) => `t_1_entry_${i + 1}`)];
    expect(batch.documents[0].transaction_ids).toEqual(ids);
    expect(batch.transactions.map(t => t.transaction_id)).toEqual(ids);
    expect(batch.transactions[0]).toMatchObject({ transaction_type: 'statement', data: { closing_balance: '1040.00' } });
    expect(batch.transactions[0].data.line_items).toBeUndefined();
    for (const tx of batch.transactions.slice(1)) {
      expect(tx).toMatchObject({ document_id: 'd_1', transaction_type: 'statement_entry', data: { amount: '1000.00', balance: '1040.00' } });
      const evidence = batch.evidence.find(e => e.transaction_id === tx.transaction_id)!;
      expect(evidence).toMatchObject({ document_id: 'd_1', field_pointer: '/amount', value: '1000.00', sources: [{ page_number: 1 }] });
      expect(tx.field_evidence['/amount']).toEqual([evidence.evidence_id]);
    }
    expect(exportEligibleTransactions(batch)).toEqual(ids);
    expect(validateBatch(batch)).toMatchObject({ ok: true, errors: [] });
    expect(buildBatch(input).transactions.map(t => t.transaction_id)).toEqual(ids);
    expect(input.output).toEqual(original);
  });
  it('requires amount or description, and blocks only the entry with a bad date', () => {
    const input = statement(4);
    input.output.line_items = [{ description: 'Description only' }, { amount: '12.00' }, { date: '2026-02-30', amount: '4.00' }, { date: '2026-10-27' }];
    input.output.rowEvidence = [];
    const batch = buildBatch(input);
    expect(blockers(batch).map(i => [i.target_id, i.rule_code])).toEqual([
      ['t_1_entry_3', 'STANDARDS_ISO8601'], ['t_1_entry_4', 'MISSING_REQUIRED'],
    ]);
    expect(exportEligibleTransactions(batch)).toEqual(['t_1', 't_1_entry_1', 't_1_entry_2']);
    expect(validateBatch(batch).ok).toBe(true);
  });
  it('compares closing balance only when every running balance parses', () => {
    const input = statement(2);
    input.output.line_items[1] = { ...input.output.line_items[1], balance: '999' };
    expect(blockers(buildBatch(input))).toContainEqual(expect.objectContaining({ target_id: 't_1', rule_code: 'TOTALS_MISMATCH' }));
    input.output.line_items[0] = { ...input.output.line_items[0], balance: 'unreadable' };
    expect(buildBatch(input).issues.some(i => i.rule_code === 'TOTALS_MISMATCH')).toBe(false);
  });
  it('keeps evidence on its owning document pages and IDs unique across segments', () => {
    const input = statement(1);
    input.output.rowEvidence!.push({ row: 0, key: 'date', page: 2, bbox: [100, 100, 200, 200], confidence: 1 });
    const batch = buildBatchFromSegments({ ...input, pages: [1, 2].map(page_number => ({ page_number, width: 595, height: 842 })), segments: [
      { pages: [1], output: input.output, boundary_status: 'confirmed' },
      { pages: [2], output: { ...input.output, fields: [], rowEvidence: [] }, boundary_status: 'confirmed' },
    ] });
    expect(batch.transactions.map(t => t.transaction_id)).toEqual(['t_1', 't_1_entry_1', 't_2', 't_2_entry_1']);
    expect(batch.transactions[1].field_evidence['/date']).toBeUndefined();
    expect(batch.evidence.every(e => e.sources.every(s => batch.documents.find(d => d.document_id === e.document_id)!.page_refs.some(p => p.page_number === s.page_number)))).toBe(true);
    expect(validateBatch(batch).ok).toBe(true);
  });
  it('preserves the published fixture and its statement identities on recomputation', () => {
    const before = structuredClone(fixture) as Batch;
    expect(validateBatch(before).ok).toBe(true);
    const next = recomputeIssues(before);
    expect(validateBatch(next).ok).toBe(true);
    expect(next.documents.map(({ status: _status, ...doc }) => doc)).toEqual(before.documents.map(({ status: _status, ...doc }) => doc));
    expect(next.transactions.map(({ status: _status, ...tx }) => tx)).toEqual(before.transactions.map(({ status: _status, ...tx }) => tx));
    expect(next.transactions.filter(t => t.document_id === 'doc_009')).toEqual(before.transactions.filter(t => t.document_id === 'doc_009'));
    expect(next.evidence).toEqual(before.evidence);
    expect(next.validation.export_eligible_transaction_ids).toEqual(expect.arrayContaining(['txn_009', 'txn_021']));
    expect(before).toEqual(fixture);
  });
  it('accepts evidence-bearing Auto cells and leaves Targeted rows single unless opted in', () => {
    const raw = { document_type: 'statement', fields: [], line_items: [{ description: { value: 'Payment', page: 1, bbox: [100, 100, 200, 200], confidence: 1 } }] };
    const parsed = checkModelOutput(raw);
    expect(parsed.line_items).toEqual([{ description: 'Payment' }]);
    expect(parsed.rowEvidence).toEqual([{ row: 0, key: 'description', page: 1, bbox: [100, 100, 200, 200], confidence: 1 }]);
    const profile: ExtractionProfile = { id: 'entries', name: 'Entries', fields: [], rowFields: [{ key: 'description', label: 'Description', type: 'text', required: true }] };
    const input = { ...statement(0), output: checkProfileOutput(raw, profile), rowsAsTransactions: false };
    expect(buildBatch(input).transactions.map(t => t.data)).toEqual([{ line_items: [{ description: 'Payment' }] }]);
    const expanded = buildBatch({ ...input, rowsAsTransactions: true });
    expect(expanded.transactions[1]).toMatchObject({ data: { description: 'Payment' }, required_fields: ['/description'], field_types: { '/description': 'text' } });
    profile.rowsAsTransactions = true;
    expect(parseProfileImport(exportProfiles([profile])).profiles).toEqual([{ ...profile, builtin: false }]);
    expect(validateProfile({ ...profile, rowsAsTransactions: 'true' as unknown as boolean })).toContain('rowsAsTransactions must be a boolean.');
  });
  it('moves whole entries on split, preserves all on merge, and refuses evidenced page reassignment', () => {
    const input = statement(2);
    input.pages = [1, 2, 3].map(page_number => ({ page_number, width: 595, height: 842 }));
    input.renderedPageCount = 3;
    input.output.rowEvidence![1].page = 2;
    const batch = buildBatch(input);
    expect(() => assignPage(batch, { file_id: input.file.file_id, page_number: 2 }, null, 'Move evidenced page')).toThrow(/evidence/);
    const split = splitDocument(batch, 'd_1', 2, 'Split statement pages');
    const second = split.documents.find(d => d.document_id !== 'd_1')!;
    expect(split.transactions.find(t => t.transaction_id === 't_1_entry_1')!.document_id).toBe('d_1');
    expect(split.transactions.find(t => t.transaction_id === 't_1_entry_2')!.document_id).toBe(second.document_id);
    expect(validateBatch(split).ok).toBe(true);
    const assigned = assignPage(split, { file_id: input.file.file_id, page_number: 3 }, 'd_1', 'Move unevidenced page');
    expect(assigned.transactions.filter(t => t.document_id === second.document_id).every(t => second.transaction_ids.includes(t.transaction_id))).toBe(true);
    const merged = mergeDocuments(assigned, ['d_1', second.document_id], 'Merge statement pages');
    expect(merged.documents[0].transaction_ids).toEqual(merged.transactions.map(t => t.transaction_id));
    expect(merged.transactions.filter(t => t.transaction_type === 'statement_entry').map(t => t.transaction_id)).toEqual(['t_1_entry_1', 't_1_entry_2']);
    expect(validateBatch(merged).ok).toBe(true);
  });
});
