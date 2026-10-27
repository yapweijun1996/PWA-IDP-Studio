import { readable } from './nav';
const titles: Record<string, string> = {
  PAGE_LIMIT_EXCEEDED: 'Some pages were not processed',
  BOUNDARY_UNCERTAIN: 'Document boundary needs review',
  PAGES_FAILED: 'Some pages failed extraction',
  MISSING_REQUIRED: 'Required information is missing',
  INVALID_DECIMAL: 'Amount or quantity is not a valid decimal',
  STANDARDS_ISO8601: 'Date must be a valid YYYY-MM-DD date',
  STANDARDS_ISO4217: 'Currency must be a recognized three-letter code',
  TOTALS_MISMATCH: 'Line item amounts do not match the total',
  FIELD_WITHOUT_EVIDENCE: 'No page evidence is available for this field',
  LOW_CONFIDENCE: 'Low confidence',
  EXTRACTION_FAILED: 'Document extraction failed',
  LEGACY_TYPE_UNMAPPED: 'Legacy document type needs classification',
};
export const issueTitle = (code: string) => titles[code] ?? readable(code);
