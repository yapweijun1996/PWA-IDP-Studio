export type BatchStatus = 'processing' | 'review_required' | 'validated' | 'partially_approved' | 'approved' | 'failed';
export type MediaType = 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/tiff';
export type RegionRole = 'full_page' | 'sub_document' | 'attachment' | 'table' | 'other';
export type PageRotation = 0 | 90 | 180 | 270;
export type PageStatus = 'pending' | 'classified' | 'error';
export type UnassignedReason = 'blank' | 'unknown' | 'ocr_failed' | 'review_pending';
export type DocumentType = 'purchase_invoice' | 'sales_invoice' | 'purchase_order' | 'sales_order' | 'delivery_order' | 'credit_note' | 'bank_receipt' | 'payment_document' | 'statement' | 'unknown';
export type DocumentStatus = 'draft' | 'validated' | 'review_required' | 'approved' | 'rejected';
export type TransactionStatus = DocumentStatus;
export type TransactionType = Exclude<DocumentType, 'statement'> | 'statement_entry';
export type BoundaryStatus = 'confirmed' | 'needs_review';
export type EvidenceMethod = 'ocr' | 'vision_llm' | 'native_text' | 'human';
export type EvidenceReviewStatus = 'unreviewed' | 'confirmed' | 'corrected' | 'rejected';
export type IssueScope = 'batch' | 'file' | 'page' | 'document' | 'transaction' | 'evidence';
export type IssueSeverity = 'info' | 'warning' | 'error' | 'blocking';
export type IssueStatus = 'open' | 'resolved' | 'waived';
export type ReviewTargetType = 'document' | 'transaction' | 'issue' | 'page' | 'evidence';
export type ReviewAction = 'confirm' | 'correct' | 'split' | 'merge' | 'assign' | 'waive' | 'approve' | 'reject';
export type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export interface BatchMetadata { batch_id: string; created_at: string; status: BatchStatus; policy_version: string; revision: number }
export interface SourceFile { file_id: string; filename: string; media_type: MediaType; sha256: string; page_count: number; storage_ref: string | null }
export interface BBox { x: number; y: number; width: number; height: number }
export interface Region { region_id: string; document_id: string; bbox: BBox; role: RegionRole }
export interface Page { file_id: string; page_number: number; width: number; height: number; rotation: PageRotation; status: PageStatus; regions: Region[]; unassigned_reason: UnassignedReason | null }
export interface PageRef { file_id: string; page_number: number; region_id: string }
export interface Document { document_id: string; document_type: DocumentType; status: DocumentStatus; page_refs: PageRef[]; transaction_ids: string[]; classification_confidence: number; boundary_status: BoundaryStatus; schema_id: string; schema_version: string }
export interface Transaction { transaction_id: string; document_id: string; transaction_type: TransactionType; status: TransactionStatus; business_key: string | null; data: Record<string, Value>; field_evidence: Record<string, string[]>; revision: number; required_fields?: string[]; field_types?: Record<string, 'text' | 'date' | 'amount' | 'quantity' | 'integer' | 'code'> }
export interface SourceRegion { file_id: string; page_number: number; bbox: BBox; coordinate_system: 'normalized_unrotated_top_left'; text_span: { start: number; end: number } | null }
export interface Evidence { evidence_id: string; document_id: string; transaction_id: string; field_pointer: string; value: Value; confidence: number; method: EvidenceMethod; sources: SourceRegion[]; review_status: EvidenceReviewStatus }
export interface Issue { issue_id: string; scope: IssueScope; target_id: string; rule_code: string; severity: IssueSeverity; message: string; status: IssueStatus; waiver_review_id: string | null }
export interface Review { review_id: string; target_type: ReviewTargetType; target_id: string; action: ReviewAction; actor_id: string; at: string; reason: string; prior_revision: number; new_revision: number }
export interface Validation { structural_valid: boolean; reference_valid: boolean; coverage_valid: boolean; business_rules_valid: boolean; export_eligible_transaction_ids: string[]; validated_at: string | null; validator_version: string }
/** Complete batch envelope; stored validation flags are advisory only. */
export interface Batch { schema_version: '2.0.0'; batch: BatchMetadata; source_files: SourceFile[]; pages: Page[]; documents: Document[]; transactions: Transaction[]; evidence: Evidence[]; issues: Issue[]; reviews: Review[]; validation: Validation }
