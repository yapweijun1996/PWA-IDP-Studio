export const DOCUMENT_TYPES = [
  'purchase_invoice',
  'sales_order',
  'purchase_order',
  'bank_receipt',
  'credit_note',
  'payment_document',
  'delivery_order',
  'receipt',
  'other',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** [x0, y0, x1, y1], normalized 0..1 of the page, origin top-left. */
export type BBox = [number, number, number, number];

export interface Evidence {
  page: number; // 1-based
  bbox: BBox | null;
  confidence: number; // 0..1
}

export type DocStatus = 'processing' | 'review_required' | 'ready' | 'approved' | 'failed';

export interface LineItem {
  description?: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
}

export interface Validation {
  schema_valid: boolean;
  totals_match: boolean | null;
  missing_required: string[];
  low_confidence: string[];
  standards_issues: string[];
  needs_review: boolean;
}

export interface AuditEntry {
  at: string;
  action: 'extracted' | 'field_edited' | 'approved';
  field?: string;
  from?: unknown;
  to?: unknown;
}

export interface Envelope {
  schema_version: '1.0';
  document_id: string;
  document_type: DocumentType;
  status: DocStatus;
  extraction: Record<string, unknown> & { line_items?: LineItem[] };
  evidence: Record<string, Evidence>;
  validation: Validation;
  model: { provider: string; model: string } | null;
  audit: AuditEntry[];
}

export interface DocumentRecord {
  id: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
  pageCount: number;
  envelope: Envelope;
  error?: string;
}

export type ProviderId = 'demo' | 'openai' | 'openrouter' | 'gemini';
