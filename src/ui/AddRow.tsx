import { useState } from 'react';
import { Button, Dialog, Field, Input, Notice } from '../ds';
import type { ExtractionProfile } from '../lib/agent/contract';
import { labelFromKey } from '../lib/profiles';
import { AUTO_ROW_KEYS } from '../lib/standards';
import type { RowColumn } from '../contract/review';
import { pointerFor } from '../contract/rules';
import type { Transaction, Value } from '../contract/types';

/**
 * The columns a new row gets: those the transaction's rows already have (in order), then any other column of the template it
 * was read with, and the standard Auto row columns when there is nothing to go by. A Targeted result brings each column's
 * declared type and required mark along, so the new row is validated like the others.
 */
export function rowColumns(tx: Transaction, profile?: ExtractionProfile): RowColumn[] {
  const rows = (Array.isArray(tx.data.line_items) ? tx.data.line_items : []).filter((row): row is Record<string, Value> => !!row && typeof row === 'object' && !Array.isArray(row));
  const keys = [...new Set([...rows.flatMap(row => Object.keys(row)), ...(profile?.rowFields.map(f => f.key) ?? [])])];
  if (!keys.length) keys.push(...AUTO_ROW_KEYS);
  const declared = (key: string) => rows.map((_, i) => tx.field_types?.[`/line_items/${i}${pointerFor(key)}`]).find(type => type !== undefined);
  return keys.map(key => { const field = profile?.rowFields.find(f => f.key === key); return { key, label: field?.label ?? labelFromKey(key), type: declared(key) ?? field?.type, ...(field?.required ? { required: true } : {}) }; });
}

/**
 * "Add row" in review: type one more detail record by hand (a stock item the page extraction missed). The row is marked as
 * entered by hand in the table and in the review trail, and the checks run again. `onAdd` may throw; its message is shown here.
 */
export function AddRow({ columns, label, rowNumber, approved, onClose, onAdd }: { columns: readonly RowColumn[]; label: (key: string) => string; rowNumber: number; approved: boolean; onClose: () => void; onAdd: (values: Record<string, string>, reason: string) => Promise<void> | void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('Row missing from the extraction');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const submit = async () => {
    setWorking(true); setError('');
    try { await onAdd(values, reason); onClose(); } catch (e) { setError(String((e as Error).message ?? e)); setWorking(false); }
  };
  return <Dialog open onClose={onClose} title={`Add row ${rowNumber} by hand`}>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <p className="ds-muted">Type the values for this row. It is marked as entered by hand, and the totals and the other checks run again. You can correct any value afterwards.</p>
      {approved && <Notice tone="warning">This document is approved. Adding a row withdraws that approval.</Notice>}
      {columns.map(column => <Field key={column.key} label={label(column.key)}><Input value={values[column.key] ?? ''} onChange={event => setValues({ ...values, [column.key]: event.target.value })} /></Field>)}
      <Field label="Reason for adding this row"><Input required value={reason} onChange={event => setReason(event.target.value)} /></Field>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="ds-row">
        <Button onClick={onClose} disabled={working}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={working || !reason.trim()}>Save row</Button>
      </div>
    </form>
  </Dialog>;
}
