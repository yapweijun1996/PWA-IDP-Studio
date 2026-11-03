import type { DocumentType, Transaction } from '../contract/types';
import { decimalKey, pointerFor } from '../contract/rules';
import { requiredKeys } from '../contract/view';
import type { ExtractionProfile, FieldType, ProfileField } from './agent/contract';
import { labelFromKey } from './profiles';

/** The field type a key implies, so a template built from an Auto result keeps the checks Auto applied by key name. */
export function fieldTypeForKey(key: string): FieldType {
  if (key === 'date' || key.endsWith('_date')) return 'date';
  if (/quantity/i.test(key)) return 'quantity';
  if (decimalKey(key)) return 'amount';
  if (key === 'currency' || key === 'uom' || /(?:^|_)(?:no|code)$/.test(key)) return 'code';
  return 'text';
}

const filled = (value: unknown) => value !== null && value !== undefined && value !== '';

/**
 * The starting point for "Customize fields" in review. A document extracted with a template starts from that template (a
 * copy; the saved one is never touched). A document extracted in Auto mode starts from what it actually contains: the
 * header fields and row columns that have a value, plus the fields its document type requires, typed by key so the
 * validation Auto applied still applies. The user then adds to it.
 */
export function templateFromTransaction(tx: Transaction, documentType: DocumentType, name: string, base?: ExtractionProfile): ExtractionProfile {
  if (base) return { ...structuredClone(base), id: crypto.randomUUID(), name, builtin: false };
  const required = requiredKeys(tx, documentType);
  const rows = Array.isArray(tx.data.line_items) ? tx.data.line_items as Record<string, unknown>[] : [];
  const headerKeys = [...new Set([...Object.keys(tx.data).filter(key => key !== 'line_items' && filled(tx.data[key])), ...required])];
  const rowKeys = [...new Set(rows.flatMap(row => Object.keys(row).filter(key => filled(row[key]))))];
  // A result that declares its field types (read with a template whose saved copy is gone) keeps them exactly; otherwise the type follows the key name.
  const declared = tx.field_types;
  const headerType = (key: string) => declared?.[pointerFor(key)];
  const rowType = (key: string) => rows.map((_, i) => declared?.[`/line_items/${i}${pointerFor(key)}`]).find(type => type !== undefined);
  const field = (key: string, isRequired: boolean, type: FieldType | undefined): ProfileField => ({ key, label: labelFromKey(key), type: type ?? fieldTypeForKey(key), ...(isRequired ? { required: true } : {}) });
  return { id: crypto.randomUUID(), name, fields: headerKeys.map(key => field(key, required.includes(key), headerType(key))), rowFields: rowKeys.map(key => field(key, false, rowType(key))) };
}
