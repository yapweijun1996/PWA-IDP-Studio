import type { SidebarItem } from '../ds';
import type { Batch } from '../contract/types';
import { transactionView } from '../contract/view';
export function reviewRows(batches: readonly Batch[]) {
  return batches.flatMap(batch => batch.transactions.map(tx => ({ batch, tx, view: transactionView(batch, tx.transaction_id) })))
    .filter(({ tx, view }) => !['validated', 'approved'].includes(tx.status) || view.blockingCount > 0 || view.fields.some(f => f.exception === 'missing'))
    .sort((a, b) => b.view.blockingCount - a.view.blockingCount || a.batch.batch.created_at.localeCompare(b.batch.batch.created_at) || a.tx.transaction_id.localeCompare(b.tx.transaction_id));
}
export function navItems(active: string, count: number): SidebarItem[] {
  return [
    { href: '#/', label: 'Home', icon: 'home', active: active === 'home' },
    { href: '#/documents', label: 'Documents', icon: 'document', active: active === 'documents' },
    { href: '#/review', label: 'Review Queue', icon: 'audit-trail', active: active === 'review', count: count || undefined },
    ...([{ label: 'Label Studio', icon: 'tag' }, { label: 'Templates', icon: 'database' }, { label: 'JSON Explorer', icon: 'code-file' }, { label: 'AI Agents', icon: 'robot' }, { label: 'Validation', icon: 'approval' }] as const).map(item => ({ ...item, href: `#/${item.label.toLowerCase().replaceAll(' ', '-')}`, disabled: true, reason: 'Coming soon' })),
    { href: '#/settings', label: 'Settings', icon: 'settings', active: active === 'settings' },
  ];
}
export const workspaceHref = (batch: Batch, transactionId?: string) => `#/doc/${encodeURIComponent(batch.batch.batch_id)}${transactionId ? `/${encodeURIComponent(transactionId)}` : ''}`;
export const readable = (text: string) => text.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
