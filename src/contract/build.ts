import type { Batch, MediaType, Value } from './types';
import type { ModelOutput } from '../lib/validate';
import { normalizeWireBox } from '../lib/bbox';
import { normalizeDecimal } from './decimal';
import { decimalKey, pointerFor, refreshIssues } from './rules';
import { validateBatch } from './validate';

export interface BuildInput {
  batchId: string;
  createdAt: string;
  file: { file_id: string; filename: string; media_type: MediaType; sha256: string; size: number };
  pages: { page_number: number; width: number; height: number }[];
  renderedPageCount: number;
  model: { provider: string; model: string } | null;
  output: ModelOutput;
}

/** JSON-safe values only; amount/quantity fields retain invalid text for review. */
export function canonicalValue(key: string, value: unknown): Value {
  if (decimalKey(key)) return normalizeDecimal(value) ?? String(value ?? '');
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map(v => canonicalValue('', v));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, canonicalValue(k, v)]));
  return String(value);
}

export function buildBatch(input: BuildInput): Batch {
  const { output, file } = input;
  const documentId = 'd_1';
  const transactionId = 't_1';
  if (!input.pages.length || !Number.isInteger(input.renderedPageCount) || input.renderedPageCount < 1 || input.renderedPageCount > input.pages.length) throw new Error('Expected a complete page manifest and at least one rendered page');
  const batch: Batch = {
    schema_version: '2.0.0',
    batch: { batch_id: input.batchId, created_at: input.createdAt, status: 'validated', policy_version: '1.0.0', revision: 1 },
    source_files: [{ file_id: file.file_id, filename: file.filename, media_type: file.media_type, sha256: file.sha256, page_count: input.pages.length, storage_ref: file.file_id }],
    pages: input.pages.map(p => ({ ...p, file_id: file.file_id, rotation: 0, status: p.page_number <= input.renderedPageCount ? 'classified' : 'pending', regions: p.page_number <= input.renderedPageCount ? [{ region_id: `r_${documentId}_${p.page_number}`, document_id: documentId, role: 'full_page', bbox: { x: 0, y: 0, width: 1, height: 1 } }] : [], unassigned_reason: p.page_number <= input.renderedPageCount ? null : 'review_pending' })),
    documents: [{ document_id: documentId, document_type: output.document_type, status: 'validated', page_refs: input.pages.filter(p => p.page_number <= input.renderedPageCount).map(p => ({ file_id: file.file_id, page_number: p.page_number, region_id: `r_${documentId}_${p.page_number}` })), transaction_ids: [transactionId], classification_confidence: output.fields.length ? output.fields.reduce((s, f) => s + f.confidence, 0) / output.fields.length : 0.5, boundary_status: 'confirmed', schema_id: `erp.${output.document_type}`, schema_version: '1.0.0' }],
    transactions: [{ transaction_id: transactionId, document_id: documentId, transaction_type: output.document_type === 'statement' ? 'statement_entry' : output.document_type, status: 'validated', business_key: null, data: {}, field_evidence: {}, revision: 1 }],
    evidence: [], issues: [], reviews: [],
    validation: { structural_valid: false, reference_valid: false, coverage_valid: false, business_rules_valid: false, export_eligible_transaction_ids: [], validated_at: null, validator_version: '1.0.0' },
  };
  const tx = batch.transactions[0];
  if (output.requiredPointers) tx.required_fields = output.requiredPointers;
  if (output.fieldTypes) tx.field_types = output.fieldTypes;
  // Last duplicate field wins, including its provenance; no orphan stale evidence.
  const fields = new Map(output.fields.filter(f => f.key !== 'line_items').map(f => [f.key, f]));
  for (const field of fields.values()) {
    const pointer = pointerFor(field.key);
    Object.defineProperty(tx.data, field.key, { value: canonicalValue(output.fieldTypes ? '' : field.key, field.value), writable: true, configurable: true, enumerable: true });
    const box = normalizeWireBox(field.bbox);
    if (!box || !batch.documents[0].page_refs.some(p => p.page_number === field.page)) continue;
    const [x0, y0, x1, y1] = box;
    const id = `e_${batch.evidence.length + 1}`;
    batch.evidence.push({ evidence_id: id, document_id: documentId, transaction_id: transactionId, field_pointer: pointer, value: tx.data[field.key], confidence: field.confidence, method: 'vision_llm', review_status: 'unreviewed', sources: [{ file_id: file.file_id, page_number: field.page, bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, coordinate_system: 'normalized_unrotated_top_left', text_span: null }] });
    tx.field_evidence[pointer] = [id];
  }
  if (output.includeRows !== false) tx.data.line_items = output.line_items.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('Line items must be objects');
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, canonicalValue(output.fieldTypes ? '' : key, value)]));
  });
  for (const cell of output.rowEvidence ?? []) {
    const box = normalizeWireBox(cell.bbox);
    if (!box || !batch.documents[0].page_refs.some(p => p.page_number === cell.page)) continue;
    const pointer = `/line_items/${cell.row}${pointerFor(cell.key)}`;
    const row = (tx.data.line_items as Record<string, Value>[])[cell.row];
    const [x0, y0, x1, y1] = box;
    const id = `e_${batch.evidence.length + 1}`;
    batch.evidence.push({ evidence_id: id, document_id: documentId, transaction_id: transactionId, field_pointer: pointer, value: row[cell.key], confidence: cell.confidence, method: 'vision_llm', review_status: 'unreviewed', sources: [{ file_id: file.file_id, page_number: cell.page, bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, coordinate_system: 'normalized_unrotated_top_left', text_span: null }] });
    tx.field_evidence[pointer] = [id];
  }
  refreshIssues(batch);
  const validation = validateBatch(batch);
  if (!validation.ok) throw new Error(validation.errors.map(e => `${e.code}: ${e.message}`).join('; '));
  return batch;
}
