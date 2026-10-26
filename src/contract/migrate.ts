import { buildBatch, type BuildInput } from './build';
import { refreshIssues } from './rules';
import type { Batch } from './types';
import type { DocumentRecord } from '../lib/types';

export interface MigrationFileInfo {
  file: BuildInput['file'];
  pages: BuildInput['pages'];
  dimensionsFallback?: boolean;
}
export function migrateV1Record(record: DocumentRecord, fileInfo: MigrationFileInfo): Batch {
  const old = record.envelope;
  const unmapped = old.document_type === 'receipt' || old.document_type === 'other';
  const batch = buildBatch({
    batchId: `legacy_${record.id}`, createdAt: new Date(record.createdAt).toISOString(),
    file: fileInfo.file, pages: fileInfo.pages, renderedPageCount: Math.min(fileInfo.pages.length, Math.max(1, record.pageCount)),
    model: old.model,
    output: {
      document_type: unmapped ? 'unknown' : old.document_type as BuildInput['output']['document_type'],
      fields: Object.entries(old.extraction).filter(([key]) => key !== 'line_items').map(([key, value]) => {
        const ev = old.evidence[key];
        const box = ev?.bbox;
        return { key, value, page: ev?.page ?? 1, confidence: ev?.confidence ?? 0.5, bbox: box ? [box[1] * 1000, box[0] * 1000, box[3] * 1000, box[2] * 1000] : null };
      }),
      line_items: old.extraction.line_items ?? [],
    },
  });
  const tx = batch.transactions[0];
  for (const entry of old.audit) {
    if (entry.action !== 'field_edited' || !entry.field) continue;
    const prior = tx.revision++;
    batch.reviews.push({ review_id: `legacy_review_${batch.reviews.length + 1}`, target_type: 'transaction', target_id: tx.transaction_id, action: 'correct', actor_id: 'legacy_user', at: entry.at, reason: `Legacy field edit: ${entry.field}`, prior_revision: prior, new_revision: tx.revision });
    const pointer = '/' + entry.field.replace(/~/g, '~0').replace(/\//g, '~1');
    for (const ev of batch.evidence.filter(e => e.field_pointer === pointer)) { ev.method = 'human'; ev.review_status = 'corrected'; }
  }
  if (unmapped) batch.issues.push({ issue_id: 'legacy_type', scope: 'document', target_id: tx.document_id, rule_code: 'LEGACY_TYPE_UNMAPPED', severity: 'warning', message: `Legacy type ${old.document_type} maps to unknown.`, status: 'open', waiver_review_id: null });
  if (fileInfo.dimensionsFallback) batch.issues.push({ issue_id: 'legacy_dimensions', scope: 'file', target_id: fileInfo.file.file_id, rule_code: 'LEGACY_DIMENSIONS_FALLBACK', severity: 'info', message: 'Original dimensions could not be read; using 595x842 fallback dimensions. Page count uses PDF metadata when available, otherwise the saved page count.', status: 'open', waiver_review_id: null });
  refreshIssues(batch);
  if (old.status === 'approved') {
    const prior = tx.revision++;
    batch.reviews.push({ review_id: `legacy_review_${batch.reviews.length + 1}`, target_type: 'transaction', target_id: tx.transaction_id, action: 'approve', actor_id: 'legacy_user', at: [...old.audit].reverse().find(a => a.action === 'approved')?.at ?? new Date(record.createdAt).toISOString(), reason: 'Preserved explicit human approval from legacy record.', prior_revision: prior, new_revision: tx.revision });
    // Preserve the human decision, not eligibility: current blockers still prevent export.
    tx.status = 'approved';
    batch.documents[0].status = 'approved';
    batch.batch.status = batch.issues.some(i => i.status === 'open' && i.severity === 'blocking') ? 'review_required' : 'approved';
  }
  batch.batch.revision = tx.revision;
  return batch;
}
