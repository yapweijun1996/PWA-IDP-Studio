import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { EmptyState, PageHeader } from '../../ds';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function Templates(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="Templates" breadcrumb={<><a href="#/">Home</a> / Templates</>} /><EmptyState title="Templates" description="This page is being built." /></section>;
}
