import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { AnySchema, ValidateFunction } from 'ajv';
import batchSchema from '../../docs/contract-v2/batch-v2.0.0.schema.json';
import type { Batch, BBox, Document, Issue, PageRef, Transaction, Value } from './types';

export interface ValidationEntry { code: string; message: string; path?: string }
export interface ValidationResult { ok: boolean; errors: ValidationEntry[]; warnings: (ValidationEntry & { severity: 'warning' })[] }
const validators = new Map<AnySchema, ValidateFunction>();
function structuralValidator(schema: AnySchema): ValidateFunction {
  let validator = validators.get(schema);
  if (!validator) {
    // Separate instances allow alternate schemas to retain the same canonical $id.
    const ajv = new Ajv2020({ allErrors: true });
    addFormats(ajv);
    validator = ajv.compile(schema);
    validators.set(schema, validator);
  }
  return validator;
}
const pageKey = (p: { file_id: string; page_number: number }) => `${p.file_id}:${p.page_number}`;
const regionKey = (p: PageRef) => JSON.stringify([p.file_id, p.page_number, p.region_id]);
const outside = (b: BBox) => b.x + b.width > 1.000001 || b.y + b.height > 1.000001;
function blocked(tx: Transaction, doc: Document, issues: readonly Issue[]): boolean {
  return issues.some(i => i.status === 'open' && i.severity === 'blocking' && (
    i.scope === 'batch' || (i.scope === 'document' && i.target_id === doc.document_id) ||
    (i.scope === 'transaction' && i.target_id === tx.transaction_id) ||
    (i.scope === 'page' && doc.page_refs.some(p => pageKey(p) === i.target_id))
  ));
}
/** Recompute workflow eligibility; never consult advisory validation results. */
export function exportEligibleTransactions(batch: Batch): string[] {
  const docs = new Map(batch.documents.map(d => [d.document_id, d]));
  return batch.transactions.filter(tx => {
    const doc = docs.get(tx.document_id);
    return doc && doc.transaction_ids.includes(tx.transaction_id) &&
      (tx.status === 'validated' || tx.status === 'approved') &&
      doc.boundary_status === 'confirmed' && !blocked(tx, doc, batch.issues);
  }).map(tx => tx.transaction_id);
}
function resolves(data: Value, pointer: string): boolean {
  if (pointer === '') return true;
  if (!/^\/(?:[^~]|~[01])*$/.test(pointer)) return false;
  let current: Value = data;
  for (const encoded of pointer.slice(1).split('/')) {
    const key = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === null || typeof current !== 'object' ||
      (Array.isArray(current) && !/^(0|[1-9]\d*)$/.test(key)) ||
      !Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = (current as Record<string, Value>)[key];
  }
  return true;
}
export function validateBatch(data: unknown, schema: AnySchema = batchSchema): ValidationResult {
  const errors: ValidationEntry[] = [];
  const warnings: ValidationResult['warnings'] = [];
  const add = (code: string, message = code) => { errors.push({ code, message }); };
  const structural = structuralValidator(schema);
  if (!structural(data)) {
    return { ok: false, errors: (structural.errors ?? []).map(e => ({ code: 'SCHEMA', message: e.message ?? e.keyword, path: e.instancePath })), warnings };
  }
  const batch = data as Batch;
  const files = new Map(batch.source_files.map(f => [f.file_id, f]));
  const pages = new Map(batch.pages.map(p => [pageKey(p), p]));
  if (files.size !== batch.source_files.length) add('DUPLICATE_FILE_ID');
  if (pages.size !== batch.pages.length) add('DUPLICATE_PAGE');
  for (const file of files.values()) {
    const actual = [...pages.values()].filter(p => p.file_id === file.file_id);
    if (actual.length !== file.page_count || actual.some(p => p.page_number > file.page_count)) add('PAGE_MANIFEST_COVERAGE', file.file_id);
  }
  const regions = new Map<string, Batch['pages'][number]['regions'][number]>();
  for (const page of batch.pages) {
    const file = files.get(page.file_id);
    if (!file || page.page_number > file.page_count) add('UNKNOWN_PAGE_SOURCE');
    if (!page.regions.length && page.unassigned_reason === null) add('UNEXPLAINED_UNASSIGNED_PAGE');
    for (const region of page.regions) {
      const key = regionKey({ ...page, region_id: region.region_id });
      if (regions.has(key)) add('DUPLICATE_REGION');
      regions.set(key, region);
      if (outside(region.bbox)) add('REGION_BBOX_OUT_OF_RANGE');
    }
  }
  const docs = new Map(batch.documents.map(d => [d.document_id, d]));
  const txs = new Map(batch.transactions.map(t => [t.transaction_id, t]));
  const evs = new Map(batch.evidence.map(e => [e.evidence_id, e]));
  if (docs.size !== batch.documents.length) add('DUPLICATE_DOCUMENT_ID');
  if (txs.size !== batch.transactions.length) add('DUPLICATE_TRANSACTION_ID');
  if (evs.size !== batch.evidence.length) add('DUPLICATE_EVIDENCE_ID');
  for (const doc of batch.documents) {
    for (const ref of doc.page_refs) if (regions.get(regionKey(ref))?.document_id !== doc.document_id) add('INVALID_DOCUMENT_PAGE_REF', doc.document_id);
    for (const id of doc.transaction_ids) if (txs.get(id)?.document_id !== doc.document_id) add('INVALID_DOCUMENT_TRANSACTION_REF', doc.document_id);
  }
  const businessKeys = new Set<string>();
  for (const tx of batch.transactions) {
    const doc = docs.get(tx.document_id);
    if (!doc || !doc.transaction_ids.includes(tx.transaction_id)) add('ORPHAN_TRANSACTION', tx.transaction_id);
    for (const [pointer, ids] of Object.entries(tx.field_evidence)) for (const id of ids) {
      const ev = evs.get(id);
      if (!ev || ev.transaction_id !== tx.transaction_id || ev.field_pointer !== pointer) add('INVALID_FIELD_EVIDENCE', id);
    }
    if (doc && tx.business_key !== null) {
      const key = JSON.stringify([doc.document_type, tx.business_key]);
      if (businessKeys.has(key)) warnings.push({ code: 'DUPLICATE_BUSINESS_KEY_CANDIDATE', message: tx.transaction_id, severity: 'warning' });
      businessKeys.add(key);
    }
  }
  for (const ev of batch.evidence) {
    const tx = txs.get(ev.transaction_id);
    const doc = docs.get(ev.document_id);
    if (!tx || !doc || tx.document_id !== doc.document_id) { add('ORPHAN_EVIDENCE', ev.evidence_id); continue; }
    if (!resolves(tx.data, ev.field_pointer)) add('EVIDENCE_POINTER_UNRESOLVED', ev.evidence_id);
    const allowed = new Set(doc.page_refs.map(pageKey));
    for (const source of ev.sources) {
      if (!allowed.has(pageKey(source))) add('EVIDENCE_SOURCE_OUTSIDE_DOCUMENT', ev.evidence_id);
      if (outside(source.bbox)) add('EVIDENCE_BBOX_OUT_OF_RANGE');
    }
  }
  for (const issue of batch.issues) {
    if ((issue.scope === 'document' && !docs.has(issue.target_id)) || (issue.scope === 'transaction' && !txs.has(issue.target_id))) add('ORPHAN_ISSUE');
    if ((issue.scope === 'file' && !files.has(issue.target_id)) || (issue.scope === 'page' && !pages.has(issue.target_id)) || (issue.scope === 'evidence' && !evs.has(issue.target_id))) add('ISSUE_TARGET_UNKNOWN');
  }
  const eligible = new Set(exportEligibleTransactions(batch));
  for (const id of batch.validation.export_eligible_transaction_ids) {
    const tx = txs.get(id);
    if (!tx || (tx.status !== 'validated' && tx.status !== 'approved')) { add('INELIGIBLE_TRANSACTION', id); continue; }
    const doc = docs.get(tx.document_id);
    if (!doc) { add('INELIGIBLE_TRANSACTION', id); continue; }
    if (doc.boundary_status !== 'confirmed') add('UNCONFIRMED_BOUNDARY', id);
    if (blocked(tx, doc, batch.issues)) add('BLOCKING_ISSUE', id);
    if (!eligible.has(id)) add('INELIGIBLE_TRANSACTION', id);
  }
  return { ok: errors.length === 0, errors, warnings };
}
