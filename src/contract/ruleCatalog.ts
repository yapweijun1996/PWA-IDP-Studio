import type { IssueScope, IssueSeverity } from './types';

export interface RuleCatalogEntry { code: string; scope: IssueScope; severity: IssueSeverity; autoResolves: boolean; waivable: boolean; title: string; description: string; howToFix: string }
const rule = (code: string, scope: IssueScope, severity: IssueSeverity, title: string, howToFix: string, autoResolves = false, waivable = false, description = title + '.'): RuleCatalogEntry => ({ code, scope, severity, title, description, howToFix, autoResolves, waivable });
export const RULE_CATALOG: readonly RuleCatalogEntry[] = [
  rule('PAGE_LIMIT_EXCEEDED', 'batch', 'blocking', 'Some pages were not processed', 'Process every pending source page.', true, false, 'The page manifest contains pending pages. Partial processing blocks export of the whole batch.'),
  rule('PAGES_FAILED', 'batch', 'blocking', 'Some pages failed extraction', 'Retry extraction for the failed pages.', true, false, 'One or more source pages have error status. Failed pages must remain in the manifest and cannot be waived.'),
  rule('BOUNDARY_UNCERTAIN', 'document', 'blocking', 'Document boundary needs review', 'Confirm document boundaries in Workspace.', true, false, 'The document grouping is not confirmed, so its transactions are not safe to export.'),
  rule('MISSING_REQUIRED', 'transaction', 'blocking', 'Required information is missing', 'Supply the required field in Workspace.', true, false, 'A required business field is absent, null or empty. Required fields come from the extraction profile or document type.'),
  rule('INVALID_DECIMAL', 'transaction', 'error', 'Amount or quantity is not a valid decimal', 'Correct the field to a decimal value.', true, false, 'An amount or quantity cannot be normalized to the contract decimal-string representation.'),
  rule('INVALID_INTEGER', 'transaction', 'blocking', 'Field must be an integer', 'Enter a safe whole-number value.', true, false, 'An integer-typed field is not a JavaScript safe integer. Decimal fractions and numeric strings do not satisfy this rule.'),
  rule('STANDARDS_ISO8601', 'transaction', 'blocking', 'Date must be a valid YYYY-MM-DD date', 'Correct the date using ISO 8601.', true, false, 'A date is malformed or does not represent a real calendar day. Date-time values are not accepted as dates.'),
  rule('STANDARDS_ISO4217', 'transaction', 'blocking', 'Currency must be a recognized three-letter code', 'Use an uppercase ISO 4217 currency code.', true, false, 'The currency value is not a supported uppercase ISO 4217 code.'),
  rule('TOTALS_MISMATCH', 'transaction', 'blocking', 'Line item amounts do not match the total', 'Correct the amounts or document an authorized reconciliation exception.', true, true, 'The decimal sum of line amounts differs from total_amount by more than the 0.01 reconciliation tolerance. An explicit waiver removes this blocker but does not alter the extracted amounts.'),
  rule('FIELD_WITHOUT_EVIDENCE', 'transaction', 'info', 'No page evidence is available for this field', 'Review the original source and document why evidence is unavailable.', true, true, 'A header field has no linked bounding-box evidence. A waiver records the review decision without fabricating source geometry.'),
  rule('LOW_CONFIDENCE', 'evidence', 'warning', 'Low confidence', 'Check the field against the original source, correct it or record a review reason.', true, true, 'Unreviewed evidence has model confidence below 0.85. Confidence is a model signal, not proof of correctness.'),
  rule('EXTRACTION_FAILED', 'document', 'blocking', 'Document extraction failed', 'Retry extraction and inspect the source document.', false, false, 'Extraction did not produce a usable document result. A waiver cannot replace successful extraction.'),
  rule('LEGACY_TYPE_UNMAPPED', 'document', 'warning', 'Legacy document type needs classification', 'Classify the migrated document.', false, false, 'A legacy document type could not be mapped and was migrated as unknown.'),
  rule('LEGACY_DIMENSIONS_FALLBACK', 'file', 'info', 'Original page dimensions unavailable', 'Reimport the original source to recover page dimensions.', false, false, 'Migration could not read original page dimensions and used fallback dimensions. This provenance note remains in the history.'),
  rule('DUPLICATE_BUSINESS_KEY_CANDIDATE', 'transaction', 'warning', 'Possible duplicate business key', 'Compare the transactions and confirm whether they represent distinct business events.'),
  ...[
    'SCHEMA', 'DUPLICATE_FILE_ID', 'DUPLICATE_PAGE', 'PAGE_MANIFEST_COVERAGE', 'UNKNOWN_PAGE_SOURCE',
    'UNEXPLAINED_UNASSIGNED_PAGE', 'DUPLICATE_REGION', 'REGION_BBOX_OUT_OF_RANGE', 'DUPLICATE_DOCUMENT_ID',
    'DUPLICATE_TRANSACTION_ID', 'DUPLICATE_EVIDENCE_ID', 'INVALID_DOCUMENT_PAGE_REF', 'INVALID_DOCUMENT_TRANSACTION_REF',
    'ORPHAN_TRANSACTION', 'INVALID_FIELD_EVIDENCE', 'ORPHAN_EVIDENCE', 'EVIDENCE_POINTER_UNRESOLVED',
    'EVIDENCE_SOURCE_OUTSIDE_DOCUMENT', 'EVIDENCE_BBOX_OUT_OF_RANGE', 'ORPHAN_ISSUE', 'ISSUE_TARGET_UNKNOWN',
    'INELIGIBLE_TRANSACTION', 'UNCONFIRMED_BOUNDARY', 'BLOCKING_ISSUE',
  ].map(code => rule(code, 'batch', 'blocking', code.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()), 'Repair the batch structure, source coverage or references before export. Integrity failures cannot be waived.')),
];
const byCode = new Map(RULE_CATALOG.map(entry => [entry.code, entry]));
export const ruleCatalogEntry = (code: string): RuleCatalogEntry | undefined => byCode.get(code);
