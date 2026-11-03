/**
 * Shared contract between the agent engine (src/lib/agent/*, extract.ts) and the
 * profile/UI layer (profiles, Home mode selector, Settings editor). Change with care:
 * both sides compile against it.
 */

export type FieldType = 'text' | 'date' | 'amount' | 'quantity' | 'integer' | 'code';

export interface ProfileField {
  /** snake_case key used in the output JSON */
  key: string;
  /** human label shown in UI and given to the model */
  label: string;
  type: FieldType;
  required?: boolean;
  /**
   * Which block of the document a header field belongs to: the document info at the top or the footer totals at the bottom.
   * Omitted means the default for its key (`defaultSection`). Display and export only; the AI is not told, and the stored batch
   * does not change. Row columns are always Row Data and never carry it.
   */
  section?: 'info' | 'footer';
}

/** What a user wants extracted in "Targeted" mode. */
export interface ExtractionProfile {
  id: string;
  name: string;
  /** header / document-level fields */
  fields: ProfileField[];
  /** columns of the repeating rows; empty array means "no rows wanted" */
  rowFields: ProfileField[];
  /** Build each repeating row as an independently reviewed transaction. */
  rowsAsTransactions?: boolean;
  builtin?: boolean;
}

export type ExtractionMode = { kind: 'auto' } | { kind: 'targeted'; profileId: string };

/** One observable step of the agent loop, for live UI. */
export interface AgentStep {
  /** tool name, or 'model' for a plain model turn */
  tool: string;
  /** short English sentence, e.g. "Zoomed into page 1 (region 120,80 → 340,620)" */
  summary: string;
  ok: boolean;
  at: number;
}

export const BUILTIN_PROFILES: ExtractionProfile[] = [
  {
    id: 'doc-info',
    name: 'Document info',
    builtin: true,
    fields: [
      { key: 'document_no', label: 'Document number', type: 'code', required: true },
      { key: 'transaction_date', label: 'Transaction date', type: 'date', required: true },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
    rowFields: [],
  },
  {
    id: 'doc-info-rows',
    name: 'Document info + rows',
    builtin: true,
    fields: [
      { key: 'document_no', label: 'Document number', type: 'code', required: true },
      { key: 'transaction_date', label: 'Transaction date', type: 'date', required: true },
      { key: 'remarks', label: 'Remarks', type: 'text' },
    ],
    rowFields: [
      { key: 'row_no', label: 'Row number', type: 'integer' },
      { key: 'stock_code', label: 'Stock code', type: 'code' },
      { key: 'stock_description', label: 'Stock description', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'quantity' },
      { key: 'uom', label: 'UOM', type: 'code' },
      { key: 'unit_price', label: 'Unit price', type: 'amount' },
      { key: 'line_subtotal', label: 'Line subtotal', type: 'amount' },
    ],
  },
  // Document info + rows + the totals printed at the bottom. Appended last: other code addresses the built-ins by position.
  {
    id: 'invoice',
    name: 'Invoice with totals',
    builtin: true,
    fields: [
      { key: 'document_no', label: 'Document number', type: 'code', required: true },
      { key: 'transaction_date', label: 'Transaction date', type: 'date', required: true },
      { key: 'customer_name', label: 'Customer', type: 'text' },
      { key: 'currency', label: 'Currency', type: 'code' },
      { key: 'subtotal_amount', label: 'Sub total', type: 'amount' },
      { key: 'tax_amount', label: 'Tax (GST)', type: 'amount' },
      { key: 'total_amount', label: 'Grand total', type: 'amount', required: true },
    ],
    rowFields: [
      { key: 'row_no', label: 'Row number', type: 'integer' },
      { key: 'stock_code', label: 'Stock code', type: 'code' },
      { key: 'description', label: 'Description', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'quantity' },
      { key: 'uom', label: 'UOM', type: 'code' },
      { key: 'unit_price', label: 'Unit price', type: 'amount' },
      { key: 'amount', label: 'Amount', type: 'amount' },
    ],
  },
];
