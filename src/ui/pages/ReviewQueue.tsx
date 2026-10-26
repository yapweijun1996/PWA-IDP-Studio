import type { Batch } from '../../contract/types';
import { DataTable, PageHeader, StatusPill } from '../../ds';
import { readable, reviewRows, workspaceHref } from '../nav';
import { go } from '../useHash';
import { loadPreferences } from '../preferences';
import { issueTitle } from '../issues';
export function ReviewQueue({ docs, loading }: { docs: Batch[]; loading?: boolean }) {
  const rows = reviewRows(docs);
  return <section className="ds-sheet"><PageHeader title="Review Queue" breadcrumb={<><a href="#/">Home</a> / Review Queue</>} description="Transactions with the most blocking issues appear first." /><DataTable caption="Transactions needing review" rows={rows} rowKey={r => `${r.batch.batch.batch_id}/${r.tx.transaction_id}`} loading={loading} density={loadPreferences().density === 'compact' ? 'compact' : 'normal'} onRowClick={r => go(workspaceHref(r.batch, r.tx.transaction_id))} emptyMessage="No transactions need review" columns={[
    { key: 'document', label: 'Document', render: r => r.batch.source_files[0].filename },
    { key: 'type', label: 'Type', render: r => readable(r.view.documentType) },
    { key: 'issues', label: 'Issues', render: r => { const issues = r.view.issues.filter(i => i.status === 'open').sort((a,b) => Number(['blocking','error'].includes(b.severity)) - Number(['blocking','error'].includes(a.severity))); return `${issues.length} · ${issues[0] ? issueTitle(issues[0].rule_code) : 'Human review required'}`; } },
    { key: 'pages', label: 'Pages', render: r => r.batch.documents.find(d => d.document_id === r.tx.document_id)?.page_refs.map(p => p.page_number).join(', ') },
    { key: 'status', label: 'Status', render: r => <StatusPill tone="warning">{readable(r.tx.status)}</StatusPill> },
  ]} /></section>;
}
