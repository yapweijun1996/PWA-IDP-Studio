import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { EmptyState, PageHeader } from '../../ds';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function LabelStudio(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="Label Studio" breadcrumb={<><a href="#/">Home</a> / Label Studio</>} /><EmptyState title="Label Studio" description="This page is being built." /></section>;
}
