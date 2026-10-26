import { useState } from 'react';
import type { Batch } from '../contract/types';
import { Button, DataTable, Dialog, IconButton, Menu, Notice, Pagination, Select, StatusPill, type Column } from '../ds';
import { go } from './useHash';
import { readable, workspaceHref } from './nav';
import { loadPreferences } from './preferences';
import { deleteLocalBatch } from './storage';
export const matchingBatches = (batches: readonly Batch[], search: string) => batches.filter(b => `${b.source_files.map(f => f.filename).join(' ')} ${b.documents.map(d => `${d.document_type} ${readable(d.document_type)}`).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()));
export function BatchTable({ docs, search = '', recent = false, loading = false, onDeleted }: { docs: Batch[]; search?: string; recent?: boolean; loading?: boolean; onDeleted?: () => void | Promise<void> }) {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [deleting, setDeleting] = useState<Batch>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const preferences = loadPreferences();
  const filtered = matchingBatches(docs, search).filter(b => status === 'all' || b.batch.status === status);
  const pageSize = recent ? 5 : preferences.pageSize;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pageCount);
  // Sorting is applied before pagination, not independently within each page.
  const [sort, setSort] = useState<{ key: string; direction: 'ascending' | 'descending' }>({ key: 'uploaded', direction: 'descending' });
  const columns: Column<Batch>[] = [
    { key: 'file', label: 'File name', render: b => b.source_files.map(f => f.filename).join(', '), sortValue: b => b.source_files[0].filename },
    { key: 'uploaded', label: 'Uploaded at', render: b => new Date(b.batch.created_at).toLocaleString(), sortValue: b => b.batch.created_at },
    { key: 'pages', label: 'Pages', render: b => b.pages.length },
    { key: 'documents', label: 'Documents', render: b => b.documents.length },
    { key: 'transactions', label: 'Transactions', render: b => b.transactions.length },
    { key: 'status', label: 'Status', render: b => <StatusPill tone={b.batch.status === 'failed' ? 'danger' : b.batch.status === 'approved' ? 'success' : 'neutral'}>{readable(b.batch.status)}</StatusPill> },
    { key: 'actions', label: 'Actions', render: b => recent ? <IconButton icon="eye" label={`Open ${b.source_files[0].filename}`} onClick={() => go(workspaceHref(b))} /> : <Menu label={`Actions for ${b.source_files[0].filename}`} items={[{ label: 'Open', onSelect: () => go(workspaceHref(b)) }, { label: 'Delete', onSelect: () => setDeleting(b) }]} /> },
  ];
  const sortValue = columns.find(c => c.key === sort.key)?.sortValue;
  const ordered = sortValue ? [...filtered].sort((a, b) => String(sortValue(a)).localeCompare(String(sortValue(b))) * (sort.direction === 'ascending' ? 1 : -1)) : filtered;
  return <div className="ds-sheet ds-batch-table">
    {!recent && <label>Status <Select aria-label="Status filter" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}>{['all', 'processing', 'review_required', 'validated', 'partially_approved', 'approved', 'failed'].map(s => <option key={s} value={s}>{readable(s)}</option>)}</Select></label>}
    <DataTable caption={recent ? 'Recent uploads' : 'Documents'} columns={columns} sort={sort} onSortChange={value => { setSort(value); setPage(1); }} rows={ordered.slice((current - 1) * pageSize, current * pageSize)} rowKey={b => b.batch.batch_id} onRowClick={b => go(workspaceHref(b))} density={preferences.density === 'compact' ? 'compact' : 'normal'} loading={loading} emptyMessage={search || status !== 'all' ? 'No matching uploads' : 'No uploads yet'} />
    {!recent && <Pagination page={current} pageCount={pageCount} onChange={setPage} />}
    {error && <Notice tone="error">{error}</Notice>}
    <Dialog open={!!deleting} onClose={() => !busy && setDeleting(undefined)} title="Delete upload?">
      <p>{deleting?.source_files[0].filename} and its batch will be removed from this browser only, including its legacy source record if migrated. Originals referenced by another batch or unrelated legacy record are kept. Provider-side data is not deleted.</p>
      <Button disabled={busy} onClick={() => setDeleting(undefined)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={async () => { if (!deleting) return; setBusy(true); try { await deleteLocalBatch(deleting); await onDeleted?.(); setDeleting(undefined); } catch (e) { setError(String(e)); } finally { setBusy(false); } }}>Delete</Button>
    </Dialog>
  </div>;
}
