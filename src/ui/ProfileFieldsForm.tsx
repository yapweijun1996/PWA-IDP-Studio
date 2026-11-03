import { Button, Card, Checkbox, Field, Input, Select } from '../ds';
import { keyFromLabel } from '../lib/profiles';
import { defaultSection, SECTION_LABELS, type Section } from '../lib/sections';
import type { ExtractionProfile, FieldType, ProfileField } from '../lib/agent/contract';

/**
 * The fields-and-columns form shared by the Templates page and "Customize fields" in review. Fields and columns are named in
 * plain words; the technical key follows the label until someone types one by hand (`advanced`). Keys in `locked` belong to
 * fields that were already saved and never change, because stored data and batch snapshots refer to them.
 */
export function ProfileFieldsForm({ draft, onChange, locked, advanced = false }: { draft: ExtractionProfile; onChange: (next: ExtractionProfile) => void; locked: ReadonlySet<string>; advanced?: boolean }) {
  const rows = (section: 'fields' | 'rowFields', title: string) => {
    const update = (index: number, patch: Partial<ProfileField>) => onChange({ ...draft, [section]: draft[section].map((f, i) => i === index ? { ...f, ...patch } : f) });
    const move = (index: number, offset: number) => { const next = [...draft[section]]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; onChange({ ...draft, [section]: next }); };
    const others = (field: ProfileField) => [...draft.fields, ...draft.rowFields].filter(f => f !== field).map(f => f.key);
    const rename = (index: number, label: string) => {
      const field = draft[section][index]; const taken = others(field);
      const follows = !locked.has(field.key) && (field.key === '' || field.key === keyFromLabel(field.label, taken));
      update(index, follows ? { label, key: keyFromLabel(label, taken) } : { label });
    };
    return <section aria-label={title}><h3>{title}</h3>{draft[section].map((field, i) => <Card key={i}><Field label={`${title} ${i + 1} label`}><Input value={field.label} onChange={e => rename(i, e.target.value)} /></Field>{advanced && <Field label={`${title} ${i + 1} key`}><Input value={field.key} onChange={e => update(i, { key: e.target.value })} /></Field>}<Field label={`${title} ${i + 1} type`}><Select value={field.type} onChange={e => update(i, { type: e.target.value as FieldType })}>{['text', 'date', 'amount', 'quantity', 'integer', 'code'].map(type => <option key={type}>{type}</option>)}</Select></Field>{section === 'fields' && <Field label={`${title} ${i + 1} section`}><Select value={field.section ?? defaultSection(field.key, field.type)} onChange={e => update(i, { section: e.target.value as Section })}>{(['info', 'footer'] as const).map(value => <option key={value} value={value}>{SECTION_LABELS[value]}</option>)}</Select></Field>}<Checkbox label="Required" checked={!!field.required} onChange={e => update(i, { required: e.target.checked })} /><div className="ds-row"><Button disabled={i === 0} onClick={() => move(i, -1)}>Move up</Button><Button disabled={i === draft[section].length - 1} onClick={() => move(i, 1)}>Move down</Button><Button onClick={() => onChange({ ...draft, [section]: draft[section].filter((_, index) => index !== i) })}>Remove field</Button></div></Card>)}<Button onClick={() => onChange({ ...draft, [section]: [...draft[section], { key: '', label: '', type: 'text' }] })}>Add {section === 'fields' ? 'field' : 'column'}</Button></section>;
  };
  return <><p className="ds-muted">Name each field in plain words, for example Batch No. Its technical key is created for you. A field is a value printed once on the document, either in the document info at the top or in the footer totals at the bottom (Section); a column is a value every row has.</p>{rows('fields', 'Header fields')}{rows('rowFields', 'Row columns')}<Checkbox label="Each row is a transaction" checked={!!draft.rowsAsTransactions} onChange={e => onChange({ ...draft, rowsAsTransactions: e.target.checked })} /></>;
}
