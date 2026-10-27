import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { EmptyState, PageHeader } from '../../ds';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function ValidationPage(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="Validation" breadcrumb={<><a href="#/">Home</a> / Validation</>} /><EmptyState title="Validation" description="This page is being built." /></section>;
}
