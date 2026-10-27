import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { EmptyState, PageHeader } from '../../ds';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function JsonExplorer(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="JSON Explorer" breadcrumb={<><a href="#/">Home</a> / JSON Explorer</>} /><EmptyState title="JSON Explorer" description="This page is being built." /></section>;
}
