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
];
