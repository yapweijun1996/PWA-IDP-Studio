import type { Batch, Document, DocumentType, Page, ReviewAction } from './types';
import { refreshIssues } from './rules';
import { validateBatch } from './validate';
import { REQUIRED_FIELDS } from '../lib/standards';

export type LayoutPage = Pick<Page, 'file_id' | 'page_number'>;
const key = (p: LayoutPage) => `${p.file_id}:${p.page_number}`;
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
function document(batch: Batch, documentId: string): Document {
  const doc = batch.documents.find(d => d.document_id === documentId);
  if (!doc) throw new Error('Unknown document');
  if (batch.transactions.some(t => t.document_id === documentId && t.status === 'approved')) throw new Error('Approved transactions make this document read-only');
  return doc;
}
function finish(batch: Batch, action: ReviewAction, target: string, reason: string, targetType: 'document' | 'page' = 'document'): Batch {
  if (!reason.trim()) throw new Error('A review reason is required');
  const prior = batch.batch.revision++;
  batch.reviews.push({ review_id: id('review'), target_type: targetType, target_id: target, action, actor_id: 'local-user', at: new Date().toISOString(), reason: reason.trim(), prior_revision: prior, new_revision: batch.batch.revision });
  refreshIssues(batch);
  const result = validateBatch(batch);
  if (!result.ok || !batch.validation.coverage_valid) throw new Error(result.errors.map(e => `${e.code}: ${e.message}`).join('; ') || 'Invalid page coverage');
  return batch;
}
function touch(batch: Batch, doc: Document) {
  for (const tx of batch.transactions.filter(t => t.document_id === doc.document_id)) tx.revision++;
}
function sortRefs(batch: Batch, doc: Document) {
  const order = new Map(batch.source_files.map((file, index) => [file.file_id, index]));
  doc.page_refs.sort((a, b) => order.get(a.file_id)! - order.get(b.file_id)! || a.page_number - b.page_number);
}
export function confirmBoundary(batch: Batch, documentId: string, reason: string): Batch {
  const next = structuredClone(batch), doc = document(next, documentId);
  if (doc.boundary_status !== 'needs_review') throw new Error('Boundary is already confirmed');
  doc.boundary_status = 'confirmed';
  touch(next, doc);
  return finish(next, 'confirm', documentId, reason);
}
export function setDocumentType(batch: Batch, documentId: string, type: DocumentType, reason: string): Batch {
  const next = structuredClone(batch), doc = document(next, documentId);
  doc.document_type = type;
  doc.schema_id = `erp.${type}`;
  doc.schema_version = '1.0.0';
  for (const tx of next.transactions.filter(t => t.document_id === documentId)) {
    tx.transaction_type = type === 'statement' && tx.transaction_type === 'statement_entry' ? 'statement_entry' : type;
    delete tx.required_fields;
    delete tx.field_types;
    if (!Object.keys(tx.data).length && !REQUIRED_FIELDS[type].length) tx.required_fields = ['/document_no'];
  }
  touch(next, doc);
  return finish(next, 'correct', documentId, reason);
}
export function assignPage(batch: Batch, page: LayoutPage, documentId: string | null, reason: string): Batch {
  const next = structuredClone(batch);
  const target = documentId === null ? null : document(next, documentId);
  const actual = next.pages.find(p => key(p) === key(page));
  if (!actual) throw new Error('Unknown page');
  const owners = next.documents.filter(d => d.page_refs.some(p => key(p) === key(page)));
  for (const owner of owners) {
    document(next, owner.document_id);
    if (next.evidence.some(e => e.document_id === owner.document_id && e.sources.some(p => key(p) === key(page)))) throw new Error('Cannot move a page referenced by document evidence');
    if (owner.page_refs.every(p => key(p) === key(page))) throw new Error('Cannot remove the last page of a document; merge it instead');
    owner.page_refs = owner.page_refs.filter(p => key(p) !== key(page));
    owner.boundary_status = 'needs_review';
    touch(next, owner);
  }
  actual.regions = [];
  actual.status = 'classified';
  actual.unassigned_reason = target ? null : 'blank';
  if (target) {
    const regionId = id('region');
    actual.regions.push({ region_id: regionId, document_id: target.document_id, role: 'full_page', bbox: { x: 0, y: 0, width: 1, height: 1 } });
    target.page_refs.push({ file_id: page.file_id, page_number: page.page_number, region_id: regionId });
    target.boundary_status = 'needs_review';
    touch(next, target);
    sortRefs(next, target);
  }
  return finish(next, 'assign', key(page), reason, 'page');
}
/** atPage is the first page of the new document, in manifest order. */
export function splitDocument(batch: Batch, documentId: string, atPage: LayoutPage | number, reason: string): Batch {
  const next = structuredClone(batch), doc = document(next, documentId);
  sortRefs(next, doc);
  const matches = doc.page_refs.filter(p => typeof atPage === 'number' ? p.page_number === atPage : key(p) === key(atPage));
  if (!matches.length || new Set(matches.map(key)).size !== 1) throw new Error('Choose an unambiguous split page');
  const index = doc.page_refs.findIndex(p => key(p) === key(matches[0]));
  if (index <= 0) throw new Error('Split must leave pages in both documents');
  const later = doc.page_refs.splice(index), moved = new Set(later.map(key));
  const newId = id('document');
  const created: Document = { ...doc, document_id: newId, page_refs: later, transaction_ids: [], boundary_status: 'needs_review', status: 'review_required' };
  doc.boundary_status = 'needs_review';
  next.documents.push(created);
  for (const page of next.pages) for (const region of page.regions) if (region.document_id === documentId && moved.has(key(page))) region.document_id = newId;
  for (const tx of [...next.transactions.filter(t => t.document_id === documentId)]) {
    const evidence = next.evidence.filter(e => e.transaction_id === tx.transaction_id);
    if (evidence.some(e => e.sources.some(s => moved.has(key(s))) && e.sources.some(s => !moved.has(key(s))))) throw new Error('Cannot split evidence spanning both sides of the boundary');
    if (tx.transaction_type === 'statement_entry' && evidence.some(e => e.sources.some(s => moved.has(key(s)))) && evidence.some(e => e.sources.some(s => !moved.has(key(s))))) throw new Error('Cannot split a statement entry across documents');
    const moving = evidence.filter(e => e.sources.length && e.sources.every(s => moved.has(key(s))));
    if (!moving.length) continue;
    let destination = tx;
    if (moving.length === evidence.length) {
      tx.document_id = newId;
      doc.transaction_ids = doc.transaction_ids.filter(t => t !== tx.transaction_id);
    } else {
      destination = { ...structuredClone(tx), transaction_id: id('transaction'), document_id: newId, business_key: null, field_evidence: {}, revision: 1 };
      next.transactions.push(destination);
    }
    created.transaction_ids.push(destination.transaction_id);
    const movingIds = new Set(moving.map(e => e.evidence_id));
    for (const e of moving) { e.document_id = newId; e.transaction_id = destination.transaction_id; }
    if (destination !== tx) {
      for (const [pointer, ids] of Object.entries(tx.field_evidence)) {
        const transferred = ids.filter(i => movingIds.has(i));
        if (transferred.length) destination.field_evidence[pointer] = transferred;
        tx.field_evidence[pointer] = ids.filter(i => !movingIds.has(i));
      }
    }
  }
  const template = batch.transactions.find(t => t.document_id === documentId);
  const required = template?.required_fields?.length ? template.required_fields : (REQUIRED_FIELDS[doc.document_type].length ? REQUIRED_FIELDS[doc.document_type] : ['document_no']).map(field => `/${field}`);
  touch(next, doc);
  touch(next, created);
  const emptyId = id('transaction');
  created.transaction_ids.push(emptyId);
  next.transactions.push({ transaction_id: emptyId, document_id: newId, transaction_type: doc.document_type, status: 'review_required', business_key: null, data: {}, field_evidence: {}, revision: 1, required_fields: [...required], ...(template?.field_types ? { field_types: structuredClone(template.field_types) } : {}) });
  return finish(next, 'split', documentId, reason);
}
export function mergeDocuments(batch: Batch, ids: string[], reason: string): Batch {
  if (ids.length < 2 || new Set(ids).size !== ids.length) throw new Error('Select at least two distinct documents');
  const next = structuredClone(batch), docs = ids.map(i => document(next, i)), first = docs[0];
  for (const other of docs.slice(1)) {
    first.page_refs.push(...other.page_refs);
    first.transaction_ids.push(...other.transaction_ids);
    for (const tx of next.transactions.filter(t => t.document_id === other.document_id)) tx.document_id = first.document_id;
    for (const ev of next.evidence.filter(e => e.document_id === other.document_id)) ev.document_id = first.document_id;
    for (const page of next.pages) for (const region of page.regions) if (region.document_id === other.document_id) region.document_id = first.document_id;
    for (const issue of next.issues.filter(i => i.scope === 'document' && i.target_id === other.document_id)) issue.target_id = first.document_id;
  }
  next.documents = next.documents.filter(d => !ids.slice(1).includes(d.document_id));
  first.boundary_status = 'needs_review';
  sortRefs(next, first);
  touch(next, first);
  return finish(next, 'merge', first.document_id, reason);
}
