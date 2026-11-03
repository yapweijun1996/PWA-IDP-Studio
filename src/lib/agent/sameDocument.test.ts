import { describe, expect, it } from 'vitest';
import { fakeStream } from '../fakeStream';
import { runWindowedExtraction } from '../windowed';
import type { Settings } from '../settings';
import type { DocumentType } from '../types';
import { SEGMENT_PROMPT } from './segment';
import { DOCUMENT_NUMBER_KEYS, documentNumber, normalizeDocumentNumber, withDuplicateNumberBoundaries } from './sameDocument';

const fields = (entries: Record<string, unknown>, document_type: DocumentType = 'purchase_order') => ({ document_type, fields: Object.entries(entries).map(([key, value]) => ({ key, value: value as string, page: 1, bbox: null, confidence: 1 })) });
const part = (pages: number[], numbers: Record<string, unknown>, boundary_status: 'confirmed' | 'needs_review' = 'confirmed', type: DocumentType = 'purchase_order') => ({ pages, output: fields(numbers, type), boundary_status });

describe('normalizeDocumentNumber', () => {
  it.each([['0004131999', '4131999'], ['4131999', '4131999'], [' PO-4131/999 ', 'po4131999'], [4131999, '4131999'], ['INV-2026-1042', 'inv20261042']])('%j -> %j', (value, expected) => expect(normalizeDocumentNumber(value)).toBe(expected));
  it.each([['1'], ['12'], [''], ['   '], ['--'], [null], [undefined], [{}], [true], ['000']])('%j says nothing about which document it is', value => expect(normalizeDocumentNumber(value)).toBeUndefined());
});

describe('documentNumber', () => {
  it('reads the number a document carries itself: by its type, or document_no for a template result', () => {
    expect(documentNumber(fields({ po_no: '0004131999' }, 'purchase_order'))).toBe('4131999');
    expect(documentNumber(fields({ invoice_no: 'INV-1042' }, 'purchase_invoice'))).toBe('inv1042');
    expect(documentNumber(fields({ invoice_no: 'INV-1042' }, 'sales_invoice'))).toBe('inv1042');
    expect(documentNumber(fields({ do_no: 'DO-77' }, 'delivery_order'))).toBe('do77');
    expect(documentNumber(fields({ order_no: 'SO-500' }, 'sales_order'))).toBe('so500');
    expect(documentNumber(fields({ document_no: 'DOC-77' }, 'unknown'))).toBe('doc77');
    expect(documentNumber(fields({ document_no: 'DOC-77' }, 'purchase_order'))).toBe('doc77'); // a template result
    expect(DOCUMENT_NUMBER_KEYS).toEqual(expect.arrayContaining(['document_no', 'invoice_no', 'po_no', 'do_no', 'order_no', 'receipt_no', 'credit_note_no', 'payment_no']));
  });
  it('does not take another number printed on the document for its own', () => {
    // A delivery order prints the purchase order it refers to: two different delivery orders for one purchase order are not one document.
    expect(documentNumber(fields({ po_no: 'PO-5551', do_no: 'DO-001' }, 'delivery_order'))).toBe('do001');
    expect(documentNumber(fields({ po_no: 'PO-5551' }, 'delivery_order'))).toBeUndefined(); // no number of its own
    expect(documentNumber(fields({ po_no: 'PO-5551', invoice_no: 'INV-9' }, 'purchase_invoice'))).toBe('inv9');
    expect(documentNumber(fields({ vendor_no: '105038', total_amount: '7178.43' }, 'purchase_order'))).toBeUndefined();
    expect(documentNumber(fields({}, 'purchase_order'))).toBeUndefined();
  });
  it('falls back to the first usual key only when the type is unknown', () => {
    expect(documentNumber(fields({ invoice_no: null, po_no: 'PO-5551' }, 'unknown'))).toBe('po5551');
    expect(documentNumber(fields({ po_no: 'PO-5551' }, 'statement'))).toBeUndefined();
  });
});

describe('withDuplicateNumberBoundaries', () => {
  it('downgrades the boundary between two documents that follow each other and carry the same number', () => {
    const result = withDuplicateNumberBoundaries([part([1, 2, 3], { po_no: '0004131999' }), part([4, 5], { po_no: '4131999' })]);
    expect(result.map(p => p.boundary_status)).toEqual(['confirmed', 'needs_review']);
    expect(result.map(p => p.pages)).toEqual([[1, 2, 3], [4, 5]]); // nothing is merged, dropped or reordered
  });
  it('leaves different numbers, missing numbers and short numbers alone', () => {
    expect(withDuplicateNumberBoundaries([part([1], { po_no: 'PO-1001' }), part([2], { po_no: 'PO-1002' })]).map(p => p.boundary_status)).toEqual(['confirmed', 'confirmed']);
    expect(withDuplicateNumberBoundaries([part([1], { po_no: 'PO-1001' }), part([2], {})]).map(p => p.boundary_status)).toEqual(['confirmed', 'confirmed']);
    expect(withDuplicateNumberBoundaries([part([1], { po_no: '1' }), part([2], { po_no: '1' })]).map(p => p.boundary_status)).toEqual(['confirmed', 'confirmed']);
  });
  it('does not flag two different delivery orders that refer to the same purchase order', () => {
    const result = withDuplicateNumberBoundaries([part([1], { po_no: 'PO-5551', do_no: 'DO-001' }, 'confirmed', 'delivery_order'), part([2], { po_no: 'PO-5551', do_no: 'DO-002' }, 'confirmed', 'delivery_order')]);
    expect(result.map(p => p.boundary_status)).toEqual(['confirmed', 'confirmed']);
    // ...but the same delivery order twice is flagged
    expect(withDuplicateNumberBoundaries([part([1], { do_no: 'DO-001' }, 'confirmed', 'delivery_order'), part([2], { do_no: 'DO-001' }, 'confirmed', 'delivery_order')]).map(p => p.boundary_status)).toEqual(['confirmed', 'needs_review']);
  });
  it('compares only documents that follow each other page for page', () => {
    // pages 4-5 are missing, so the second document is not the continuation of the first
    expect(withDuplicateNumberBoundaries([part([1, 2, 3], { po_no: 'PO-1001' }), part([6, 7], { po_no: 'PO-1001' })]).map(p => p.boundary_status)).toEqual(['confirmed', 'confirmed']);
  });
  it('keeps a boundary that was already uncertain, and never makes one more certain', () => {
    const result = withDuplicateNumberBoundaries([part([1], { po_no: 'PO-1001' }, 'needs_review'), part([2], { po_no: 'PO-1001' }, 'needs_review')]);
    expect(result.map(p => p.boundary_status)).toEqual(['needs_review', 'needs_review']);
  });
  it('looks at each boundary on its own along a longer run', () => {
    const result = withDuplicateNumberBoundaries([part([1], { po_no: 'AAA-1' }), part([2], { po_no: 'AAA-1' }), part([3], { po_no: 'BBB-2' }), part([4], { po_no: 'BBB-2' })]);
    expect(result.map(p => p.boundary_status)).toEqual(['confirmed', 'needs_review', 'confirmed', 'needs_review']);
  });
  it('does not change its input', () => {
    const input = [part([1], { po_no: 'PO-1001' }), part([2], { po_no: 'PO-1001' })];
    withDuplicateNumberBoundaries(input);
    expect(input[1].boundary_status).toBe('confirmed');
  });
});

describe('a boundary the model invents inside one document (a 12-page scanned purchase order)', () => {
  const settings: Settings = { provider: 'openai', keys: { openai: 'test' }, models: {}, maxPages: 100 };
  const decision = (page: number, starts_new_document: boolean) => ({ page, starts_new_document, confidence: 0.99, document_type: 'purchase_order' as const });
  // Evidence pages are absolute: the first part starts at page 1, the second at page 10.
  const output = (po: string | null, page: number) => JSON.stringify({ document_type: 'purchase_order', fields: [{ key: 'supplier_name', value: 'BAN LEONG TECHNOLOGIES LTD', page, bbox: [0, 0, 100, 100], confidence: 1 }, ...(po ? [{ key: 'po_no', value: po, page, bbox: [0, 0, 100, 100], confidence: 1 }] : [])], line_items: [] });
  // Window 1 is pages 1-10 and invents a start at page 10; window 2 is pages 10-12.
  const windows = [JSON.stringify({ pages: [...Array.from({ length: 9 }, (_, i) => decision(i + 1, i === 0)), decision(10, true)] }), JSON.stringify({ pages: [10, 11, 12].map(p => decision(p, false)) })];
  const run = (first: string | null, second: string | null) => runWindowedExtraction({
    batchId: 'b', createdAt: '2026-11-03T00:00:00Z', file: { file_id: 'f', filename: 'scan.pdf', media_type: 'application/pdf' as const, sha256: 'a'.repeat(64), size: 10 },
    manifest: Array.from({ length: 12 }, (_, n) => ({ page_number: n + 1, width: 10, height: 10 })), settings,
    pageSource: { pageCount: 12, async render(page: number) { return { page, width: 10, height: 10, data: 'AAAA', mimeType: 'image/jpeg' as const }; }, async textItems() { return []; }, async dispose() {} },
    streamFn: fakeStream([...windows, output(first, 1), output(second, 10)]),
  });

  it('is flagged for review when both parts carry the same document number, so it cannot pass as two documents', async () => {
    const { batch } = await run('0004131999', '0004131999');
    expect(batch.documents.map(d => d.page_refs.length)).toEqual([9, 3]);
    expect(batch.documents.map(d => d.boundary_status)).toEqual(['confirmed', 'needs_review']);
    expect(batch.issues.filter(i => i.rule_code === 'BOUNDARY_UNCERTAIN' && i.status === 'open').map(i => i.target_id)).toEqual(['d_2']);
    expect(batch.batch.status).toBe('review_required');
  });
  it('is not flagged when the two parts really are different documents', async () => {
    const { batch } = await run('0004131999', '0004132000');
    expect(batch.documents.map(d => d.boundary_status)).toEqual(['confirmed', 'confirmed']);
    expect(batch.issues.some(i => i.rule_code === 'BOUNDARY_UNCERTAIN')).toBe(false);
  });
  it('is not flagged when one part has no number to compare', async () => {
    const { batch } = await run('0004131999', null);
    expect(batch.documents.map(d => d.boundary_status)).toEqual(['confirmed', 'confirmed']);
  });
});

describe('the segmentation prompt', () => {
  it('defines a boundary strictly and says a change of classification is not one', () => {
    expect(SEGMENT_PROMPT).toContain('starts_new_document is true ONLY when the page itself visibly begins a different document');
    expect(SEGMENT_PROMPT).toContain('"Page n of m"');
    expect(SEGMENT_PROMPT).toContain('A change in how well you can read or classify a page is not a new document');
    expect(SEGMENT_PROMPT).toContain('When unsure, answer false');
    expect(SEGMENT_PROMPT).toContain('Return only JSON {pages:[{page,document_type,starts_new_document,confidence}]}'); // the reply shape the parser expects
  });
});
