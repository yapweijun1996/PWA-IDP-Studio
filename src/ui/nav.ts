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
    { href: '#/label-studio', label: 'Label Studio', icon: 'tag', active: active === 'labels' },
    { href: '#/templates', label: 'Templates', icon: 'database', active: active === 'templates' },
    { href: '#/json-explorer', label: 'JSON Explorer', icon: 'code-file', active: active === 'explorer' },
    { href: '#/ai-agents', label: 'AI Agents', icon: 'robot', active: active === 'agents' },
    { href: '#/validation', label: 'Validation', icon: 'approval', active: active === 'validation' },
    { href: '#/settings', label: 'Settings', icon: 'settings', active: active === 'settings' },
  ];
}
export const workspaceHref = (batch: Batch, transactionId?: string) => `#/doc/${encodeURIComponent(batch.batch.batch_id)}${transactionId ? `/${encodeURIComponent(transactionId)}` : ''}`;
export const readable = (text: string) => text.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
