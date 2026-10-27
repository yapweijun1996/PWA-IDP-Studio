import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { EmptyState, PageHeader } from '../../ds';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
export function AiAgents(_props: StudioPageProps) {
  return <section className="ds-sheet"><PageHeader title="AI Agents" breadcrumb={<><a href="#/">Home</a> / AI Agents</>} /><EmptyState title="AI Agents" description="This page is being built." /></section>;
}
