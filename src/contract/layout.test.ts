import { describe, expect, it } from 'vitest';
import edgeFixture from '../../docs/contract-v2/sample-100-pages-22-transactions-edge-cases.json';
import type { Batch } from './types';
import { buildBatch } from './build';
import { invoiceInput } from './fixtures';
import { recomputeIssues } from './review';
import { assignPage, confirmBoundary, mergeDocuments, setDocumentType, splitDocument } from './layout';
import { exportEligibleTransactions, validateBatch } from './validate';

function small(): Batch {
  const input = invoiceInput();
  input.pages = Array.from({ length: 4 }, (_, i) => ({ page_number: i + 1, width: 595, height: 842 }));
  input.renderedPageCount = 3;
  const batch = buildBatch(input);
  batch.documents[0].boundary_status = 'needs_review';
  return recomputeIssues(batch);
}
for (const [name, fixture] of [['small', small], ['100-page edge cases', () => structuredClone(edgeFixture) as Batch]] as const) {
  describe(name, () => {
    it('confirms boundaries immutably with a reasoned revision audit', () => {
      const before = fixture(), snapshot = structuredClone(before);
      const doc = before.documents.find(d => d.boundary_status === 'needs_review')!;
      const after = confirmBoundary(before, doc.document_id, 'Checked original');
      expect(before).toEqual(snapshot);
      expect(after.documents.find(d => d.document_id === doc.document_id)?.boundary_status).toBe('confirmed');
      expect(after.issues.some(i => i.target_id === doc.document_id && i.rule_code === 'BOUNDARY_UNCERTAIN' && i.status === 'open')).toBe(false);
      expect(after.reviews.at(-1)).toMatchObject({ target_type: 'document', target_id: doc.document_id, action: 'confirm', actor_id: 'local-user', reason: 'Checked original', prior_revision: before.batch.revision, new_revision: before.batch.revision + 1 });
      expect(validateBatch(after).ok).toBe(true);
      expect(after.validation.coverage_valid).toBe(true);
      expect(() => confirmBoundary(after, doc.document_id, 'Again')).toThrow(/already confirmed/);
      expect(() => confirmBoundary(before, doc.document_id, ' ')).toThrow(/reason/);
      expect(() => confirmBoundary(before, 'absent', 'Review')).toThrow(/Unknown document/);
    });
    it('changes type and replaces stale required-field rules', () => {
      const before = fixture(), doc = before.documents[0];
      before.transactions.find(t => t.document_id === doc.document_id)!.required_fields = [];
      const after = setDocumentType(before, doc.document_id, 'bank_receipt', 'Receipt not invoice');
      expect(after.documents[0]).toMatchObject({ document_type: 'bank_receipt', schema_id: 'erp.bank_receipt' });
      expect(after.transactions.filter(t => t.document_id === doc.document_id).every(t => t.transaction_type === 'bank_receipt')).toBe(true);
      expect(after.issues.some(i => i.rule_code === 'MISSING_REQUIRED' && i.status === 'open' && i.message.includes('/receipt_no'))).toBe(true);
      expect(before.documents[0].document_type).not.toBe('bank_receipt');
      expect(validateBatch(after).ok).toBe(true);
      expect(() => setDocumentType(before, doc.document_id, 'bank_receipt', '')).toThrow(/reason/);
    });
    it('splits later pages with an empty blocked transaction and safe evidence ownership', () => {
      const before = fixture(), doc = before.documents[0], splitPage = doc.page_refs[1];
      const after = splitDocument(before, doc.document_id, splitPage, 'Separate attachment');
      const added = after.documents.find(d => !before.documents.some(old => old.document_id === d.document_id))!;
      expect(added.page_refs).toEqual(doc.page_refs.slice(1));
      const empty = after.transactions.find(t => t.document_id === added.document_id && !Object.keys(t.data).length)!;
      expect(empty.status).toBe('review_required');
      expect(added.boundary_status).toBe('needs_review');
      expect(after.issues.some(i => i.target_id === empty.transaction_id && i.rule_code === 'MISSING_REQUIRED' && i.status === 'open')).toBe(true);
      expect(exportEligibleTransactions(after)).not.toContain(empty.transaction_id);
      expect(validateBatch(after).ok).toBe(true);
      expect(after.validation.coverage_valid).toBe(true);
      expect(before.documents).not.toContainEqual(added);
      expect(() => splitDocument(before, doc.document_id, doc.page_refs[0], 'Bad cut')).toThrow(/both documents/);
      expect(() => splitDocument(before, doc.document_id, 999, 'Bad cut')).toThrow(/split page/);
      expect(() => splitDocument(before, doc.document_id, splitPage, '')).toThrow(/reason/);
    });
    it('assigns pending and failed pages, then explicitly marks them blank', () => {
      const before = fixture();
      let page = before.pages.find(p => !p.regions.length);
      if (!page) {
        // The sample has complete coverage: make a valid unassigned page without evidence.
        page = before.pages.find(p => !before.evidence.some(e => e.sources.some(s => s.file_id === p.file_id && s.page_number === p.page_number)))!;
        for (const d of before.documents) d.page_refs = d.page_refs.filter(p => p.file_id !== page!.file_id || p.page_number !== page!.page_number);
        page.regions = []; page.unassigned_reason = 'review_pending';
      }
      const doc = before.documents[0];
      for (const status of ['pending', 'error'] as const) {
        page.status = status;
        const snapshot = structuredClone(before);
        const after = assignPage(before, page, doc.document_id, 'Read original');
        const moved = after.pages.find(p => p.file_id === page!.file_id && p.page_number === page!.page_number)!;
        expect(moved.status).toBe('classified');
        expect(moved.unassigned_reason).toBeNull();
        expect(moved.regions[0].document_id).toBe(doc.document_id);
        expect(after.evidence).toEqual(before.evidence);
        expect(before).toEqual(snapshot);
        expect(validateBatch(after).ok).toBe(true);
        const blank = assignPage(after, page, null, 'Blank separator');
        expect(blank.pages.find(p => p.file_id === page!.file_id && p.page_number === page!.page_number)).toMatchObject({ regions: [], unassigned_reason: 'blank', status: 'classified' });
        expect(validateBatch(blank).ok).toBe(true);
      }
      const evidenced = before.pages.find(p => before.evidence.some(e => e.sources.some(s => s.file_id === p.file_id && s.page_number === p.page_number)))!;
      expect(() => assignPage(before, evidenced, null, 'Unsafe move')).toThrow(/evidence/);
      expect(() => assignPage(before, { file_id: 'missing', page_number: 1 }, null, 'Move')).toThrow(/Unknown page/);
      expect(() => assignPage(before, page!, doc.document_id, '')).toThrow(/reason/);
    });
    it('merges without losing transactions or evidence', () => {
      const original = fixture();
      const before = original.documents.length > 1 ? original : splitDocument(original, original.documents[0].document_id, original.documents[0].page_refs[1], 'Prepare two documents');
      const ids = before.documents.slice(0, 2).map(d => d.document_id);
      const after = mergeDocuments(before, ids, 'Same document');
      expect(after.transactions.map(t => t.transaction_id)).toEqual(before.transactions.map(t => t.transaction_id));
      expect(after.documents[0].transaction_ids).toEqual(before.documents.slice(0, 2).flatMap(d => d.transaction_ids));
      expect(after.documents[0].boundary_status).toBe('needs_review');
      expect(after.documents[0].document_type).toBe(before.documents[0].document_type);
      expect(after.evidence.map(e => e.sources)).toEqual(before.evidence.map(e => e.sources));
      expect(validateBatch(after).ok).toBe(true);
      expect(after.validation.coverage_valid).toBe(true);
      expect(() => mergeDocuments(before, [ids[0]], 'One')).toThrow(/two distinct/);
      expect(() => mergeDocuments(before, [ids[0], ids[0]], 'Duplicate')).toThrow(/distinct/);
      expect(() => mergeDocuments(before, ids, '')).toThrow(/reason/);
    });
    it('refuses every operation involving approved transactions', () => {
      const before = fixture(), doc = before.documents[0];
      before.transactions.find(t => t.document_id === doc.document_id)!.status = 'approved';
      const snapshot = structuredClone(before);
      for (const run of [
        () => confirmBoundary(before, doc.document_id, 'Review'),
        () => setDocumentType(before, doc.document_id, 'unknown', 'Review'),
        () => splitDocument(before, doc.document_id, doc.page_refs[1], 'Review'),
        () => assignPage(before, doc.page_refs[0], null, 'Review'),
        () => assignPage(before, before.pages.at(-1)!, doc.document_id, 'Review'),
        () => mergeDocuments(before, [doc.document_id, 'other'], 'Review'),
      ]) {
        expect(run).toThrow(/read-only/);
        expect(before).toEqual(snapshot);
      }
    });
    it('refuses empty documents and evidence crossing the split boundary', () => {
      const before = fixture(), doc = before.documents[0], last = doc.page_refs.at(-1)!;
      const split = splitDocument(before, doc.document_id, last, 'Last page is separate');
      expect(() => assignPage(split, last, null, 'Remove final page')).toThrow(/last page/);
      expect(() => mergeDocuments(before, [doc.document_id, 'missing'], 'Merge')).toThrow(/Unknown document/);
      const evidence = before.evidence.find(e => e.document_id === doc.document_id)!;
      evidence.sources.push({ ...structuredClone(evidence.sources[0]), page_number: doc.page_refs[1].page_number });
      expect(() => splitDocument(before, doc.document_id, doc.page_refs[1], 'Ambiguous evidence')).toThrow(/spanning both sides/);
      expect(() => setDocumentType(before, 'missing', 'bank_receipt', 'Review')).toThrow(/Unknown document/);
      expect(() => splitDocument(before, 'missing', last, 'Review')).toThrow(/Unknown document/);
      expect(() => assignPage(before, last, 'missing', 'Review')).toThrow(/Unknown document/);
    });
  });
}
it('moves evidence with its transaction or partitions mixed transactions without changing sources', () => {
  const before = small(), tx = before.transactions[0];
  before.evidence[0].sources[0].page_number = 2;
  const after = splitDocument(before, before.documents[0].document_id, 2, 'New boundary');
  const moved = after.evidence.find(e => e.evidence_id === before.evidence[0].evidence_id)!;
  expect(moved.document_id).not.toBe(before.evidence[0].document_id);
  expect(moved.transaction_id).not.toBe(tx.transaction_id);
  expect(moved.sources).toEqual(before.evidence[0].sources);
  expect(validateBatch(after).ok).toBe(true);
  for (const e of before.evidence) for (const source of e.sources) source.page_number = 2;
  const allMoved = splitDocument(before, before.documents[0].document_id, 2, 'All evidence belongs later');
  expect(allMoved.transactions.find(t => t.transaction_id === tx.transaction_id)?.document_id).not.toBe(tx.document_id);
  expect(validateBatch(allMoved).ok).toBe(true);
  before.evidence[0].sources.push({ ...structuredClone(before.evidence[0].sources[0]), page_number: 1 });
  expect(() => splitDocument(before, before.documents[0].document_id, 2, 'Straddling')).toThrow(/spanning both sides/);
});
it('preserves both statement transactions through merge and split', () => {
  const before = structuredClone(edgeFixture) as Batch;
  const statement = before.documents.find(d => d.document_type === 'statement')!;
  const after = splitDocument(before, statement.document_id, statement.page_refs[1], 'Statement sections');
  expect(after.transactions.filter(t => statement.transaction_ids.includes(t.transaction_id))).toHaveLength(2);
  const added = after.documents.find(d => !before.documents.some(o => o.document_id === d.document_id))!;
  expect(after.transactions.find(t => t.document_id === added.document_id && !Object.keys(t.data).length)?.status).toBe('review_required');
  const merged = mergeDocuments(after, [statement.document_id, added.document_id], 'Rejoin statement');
  expect(merged.documents.find(d => d.document_id === statement.document_id)?.transaction_ids).toEqual(expect.arrayContaining(statement.transaction_ids));
  expect(validateBatch(merged).ok).toBe(true);
});
it('preserves profile requirements on empty split transactions', () => {
  const before = small();
  before.transactions[0].required_fields = ['/custom_reference'];
  before.transactions[0].field_types = { '/custom_reference': 'text' };
  const after = splitDocument(before, before.documents[0].document_id, 2, 'Separate profile document');
  const empty = after.transactions.find(t => !Object.keys(t.data).length)!;
  expect(empty.required_fields).toEqual(['/custom_reference']);
  expect(empty.field_types).toEqual({ '/custom_reference': 'text' });
  expect(after.issues.some(i => i.target_id === empty.transaction_id && i.rule_code === 'MISSING_REQUIRED' && i.message.startsWith('/custom_reference:'))).toBe(true);
  expect(validateBatch(after).ok).toBe(true);
});
it('keeps shared-page regions together when splitting a merged document', () => {
  const before = structuredClone(edgeFixture) as Batch;
  const owners = before.documents.filter(d => d.page_refs.some(p => p.page_number === 2));
  expect(owners).toHaveLength(2);
  const merged = mergeDocuments(before, owners.map(d => d.document_id), 'Shared page belongs together');
  const after = splitDocument(merged, owners[0].document_id, { file_id: before.pages[0].file_id, page_number: 2 }, 'Split at physical page');
  const later = after.documents.find(d => !merged.documents.some(old => old.document_id === d.document_id))!;
  expect(later.page_refs.filter(p => p.page_number === 2)).toHaveLength(2);
  expect(validateBatch(after).ok).toBe(true);
});
it('requires a file-qualified split when page numbers repeat across source files', () => {
  const before = small(), file = before.source_files[0];
  before.source_files.push({ ...file, file_id: 'second_file', storage_ref: null });
  before.pages.push(...before.pages.map(p => ({ ...structuredClone(p), file_id: 'second_file', regions: [], unassigned_reason: 'unknown' as const, status: 'classified' as const })));
  const assigned = assignPage(before, { file_id: 'second_file', page_number: 2 }, before.documents[0].document_id, 'Attach second source');
  expect(() => splitDocument(assigned, before.documents[0].document_id, 2, 'Ambiguous')).toThrow(/unambiguous/);
  const after = splitDocument(assigned, before.documents[0].document_id, { file_id: 'second_file', page_number: 2 }, 'Explicit source');
  expect(validateBatch(after).ok).toBe(true);
});
it('keeps empty split data blocked when reclassified as a statement', () => {
  const before = small();
  const split = splitDocument(before, before.documents[0].document_id, 2, 'Split');
  const created = split.documents.find(d => !before.documents.some(old => old.document_id === d.document_id))!;
  const changed = setDocumentType(split, created.document_id, 'statement', 'Statement section');
  const confirmed = confirmBoundary(changed, created.document_id, 'Confirmed');
  const empty = confirmed.transactions.find(t => t.document_id === created.document_id && !Object.keys(t.data).length)!;
  expect(empty.transaction_type).toBe('statement_entry');
  expect(empty.status).toBe('review_required');
  expect(exportEligibleTransactions(confirmed)).not.toContain(empty.transaction_id);
  expect(confirmed.issues.some(i => i.target_id === empty.transaction_id && i.rule_code === 'MISSING_REQUIRED' && i.status === 'open')).toBe(true);
});
