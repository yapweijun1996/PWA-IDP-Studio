import { useState } from 'react';
import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { Card, Checkbox, DataTable, PageHeader } from '../../ds';
import { ProfileEditor } from '../ProfileEditor';
import { readable } from '../nav';
import { AUTO_HEADER_KEYS, AUTO_ROW_KEYS, REQUIRED_FIELDS, TOTAL_KEYS } from '../../lib/standards';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
const words = (keys: readonly string[]) => keys.map(readable).join(', ');
export function Templates(_props: StudioPageProps) {
  const [advanced, setAdvanced] = useState(false);
  const info = AUTO_HEADER_KEYS.filter(key => !TOTAL_KEYS.includes(key));
  return <section className="ds-sheet"><PageHeader title="Templates" breadcrumb={<><a href="#/">Home</a> / Templates</>} description="A template remembers which fields to read from one kind of document, for example one supplier's invoice. You do not need one: upload a file and AI chooses the fields. Create a template only when you want the same extra fields every time." />
    <Checkbox label="Show technical keys" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />
    <ProfileEditor advanced={advanced} />
    <Card><h2>Standard fields by document type</h2>
      <p>Without a template, AI looks for these fields and returns only the ones printed on the document.</p>
      <h3>Document info</h3><p>{words(info)}</p>
      <h3>Row columns</h3><p>{words(AUTO_ROW_KEYS)}</p>
      <h3>Totals</h3><p>{words(TOTAL_KEYS)}</p>
      <DataTable caption="Required standard fields" rows={Object.entries(REQUIRED_FIELDS)} rowKey={row => row[0]} columns={[{ key: 'type', label: 'Document type', render: row => row[0].replaceAll('_', ' ') }, { key: 'fields', label: 'Required fields', render: row => (advanced ? row[1].join(', ') : words(row[1])) || 'None' }]} />
      {advanced && <><h3>Auto-mode header keys</h3><ul>{AUTO_HEADER_KEYS.map(key => <li key={key}><code>{key}</code></li>)}</ul><h3>Auto-mode row keys</h3><ul>{AUTO_ROW_KEYS.map(key => <li key={key}><code>{key}</code></li>)}</ul></>}
    </Card></section>;
}
