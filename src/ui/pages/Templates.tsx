import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { Card, DataTable, PageHeader } from '../../ds';
import { ProfileEditor } from '../ProfileEditor';
import { AUTO_HEADER_KEYS, AUTO_ROW_KEYS, REQUIRED_FIELDS } from '../../lib/standards';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function Templates(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="Templates" breadcrumb={<><a href="#/">Home</a> / Templates</>} description="Design Targeted extraction profiles. Auto mode uses standard document fields." /><ProfileEditor /><Card><h2>Standard fields by document type</h2><DataTable caption="Required standard fields" rows={Object.entries(REQUIRED_FIELDS)} rowKey={row => row[0]} columns={[{ key: 'type', label: 'Document type', render: row => row[0].replaceAll('_', ' ') }, { key: 'fields', label: 'Required fields', render: row => row[1].join(', ') || 'None' }]} /><h3>Auto-mode header keys</h3><ul>{AUTO_HEADER_KEYS.map(key => <li key={key}><code>{key}</code></li>)}</ul><h3>Auto-mode row keys</h3><ul>{AUTO_ROW_KEYS.map(key => <li key={key}><code>{key}</code></li>)}</ul></Card></section>;
}
