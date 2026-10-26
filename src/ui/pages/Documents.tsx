import type { Batch } from '../../contract/types';
import { PageHeader } from '../../ds';
import { BatchTable } from '../BatchTable';
export function Documents({ docs, search, loading, onDeleted }: { docs: Batch[]; search: string; loading?: boolean; onDeleted: () => void | Promise<void> }) {
  return <section className="ds-sheet"><PageHeader title="Documents" breadcrumb={<><a href="#/">Home</a> / Documents</>} description="Search, review and manage uploads stored in this browser." /><BatchTable docs={docs} search={search} loading={loading} onDeleted={onDeleted} /></section>;
}
