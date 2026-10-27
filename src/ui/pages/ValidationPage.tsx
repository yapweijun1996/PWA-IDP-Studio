import { useState } from 'react';
import type { Batch, Issue } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { Button, DataTable, Dialog, Field, Input, Notice, PageHeader, Select, StatusPill } from '../../ds';
import { RULE_CATALOG, ruleCatalogEntry } from '../../contract/ruleCatalog';
import { refreshIssues } from '../../contract/rules';
import { validateBatch, exportEligibleTransactions } from '../../contract/validate';
import { waiveIssue, reopenIssue } from '../../contract/review';
import { putBatch } from '../../lib/db';
import { readable, workspaceHref } from '../nav';
import { issueTitle } from '../issues';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
const severities = ['blocking', 'error', 'warning', 'info'] as const;
function issueHref(batch: Batch, issue: Issue) {
  const transaction = batch.transactions.find(tx => tx.transaction_id === issue.target_id || tx.document_id === issue.target_id || batch.evidence.some(ev => ev.evidence_id === issue.target_id && ev.transaction_id === tx.transaction_id) || batch.documents.some(doc => doc.document_id === tx.document_id && doc.page_refs.some(p => p.file_id === issue.target_id || `${p.file_id}:${p.page_number}` === issue.target_id)));
  return workspaceHref(batch, transaction?.transaction_id);
}
export function ValidationPage({ docs, loading, refresh }: StudioPageProps) {
  const [severity, setSeverity] = useState('');
  const [rule, setRule] = useState('');
  const [batchId, setBatchId] = useState('');
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(RULE_CATALOG[0].code);
  const [decision, setDecision] = useState<{ batch: Batch; issue: Issue }>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const all = docs.flatMap(batch => batch.issues.map(issue => ({ batch, issue })));
  const rows = all.filter(({ batch, issue }) => (!severity || issue.severity === severity) && (!rule || issue.rule_code === rule) && (!batchId || batch.batch.batch_id === batchId) && (!status || issue.status === status));
  const counts = (s: string) => all.filter(({ issue }) => issue.status === s).length;
  const groups = [...new Set(all.map(r => r.issue.rule_code))].map(code => ({ code, count: all.filter(r => r.issue.rule_code === code && r.issue.status === 'open').length, batches: docs.filter(b => b.issues.some(i => i.rule_code === code && i.status === 'open')) })).filter(g => g.count).sort((a, b) => b.count - a.count);
  const eligible = docs.reduce((n, b) => n + (validateBatch(b).ok ? exportEligibleTransactions(b).length : 0), 0);
  const total = docs.reduce((n, b) => n + b.transactions.length, 0);
  const reasons = new Map<string, number>();
  for (const { issue } of all) if (issue.status === 'open' && issue.severity === 'blocking') reasons.set(issue.rule_code, (reasons.get(issue.rule_code) ?? 0) + 1);
  for (const batch of docs) for (const entry of validateBatch(batch).errors) reasons.set(entry.code, (reasons.get(entry.code) ?? 0) + 1);
  const topReasons = [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const detail = ruleCatalogEntry(selected)!;
  async function revalidate(batches: Batch[]) {
    setBusy(true); setError(''); setResult('');
    try {
      const messages: string[] = [];
      for (const batch of batches) {
        const before = batch.issues.filter(i => i.status === 'open').length;
        const next = refreshIssues(structuredClone(batch));
        const validation = validateBatch(next);
        await putBatch(next);
        messages.push(`${batch.batch.batch_id}: ${before} → ${next.issues.filter(i => i.status === 'open').length} open; ${validation.errors.length} integrity errors`);
      }
      await refresh(); setResult(messages.join('; '));
    } catch (e) { setError(String(e)); await refresh(); } finally { setBusy(false); }
  }
  async function saveDecision() {
    if (!decision) return;
    setBusy(true); setError('');
    try {
      const next = (decision.issue.status === 'waived' ? reopenIssue : waiveIssue)(decision.batch, decision.issue.issue_id, reason);
      await putBatch(next); await refresh(); setDecision(undefined); setReason('');
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  return <section className="ds-sheet ds-validation"><PageHeader title="Validation" breadcrumb={<><a href="#/">Home</a> / Validation</>} description="Issues and export readiness across all stored batches." />
    {loading && <Notice tone="info">Loading stored batches…</Notice>}
    {!loading && !docs.length && <Notice tone="info">No stored batches. Upload documents to inspect validation issues.</Notice>}
    {error && <Notice tone="error">{error}</Notice>}{result && <Notice tone="info">{result}</Notice>}
    <div className="ds-row" aria-label="Issue counters">{severities.map(s => <p key={s}>Open {s}: <strong>{all.filter(r => r.issue.status === 'open' && r.issue.severity === s).length}</strong></p>)}<p>Waived: <strong>{counts('waived')}</strong></p><p>Resolved: <strong>{counts('resolved')}</strong></p></div>
    <h2>Export eligibility</h2><p>{eligible} eligible · {total - eligible} blocked transactions</p>
    <p>Top blocking reasons: {topReasons.map(([code, count]) => `${issueTitle(code)} (${count})`).join('; ') || (total > eligible ? 'Transaction status or unconfirmed document boundary' : 'None')}</p>
    <Button disabled={busy || loading || !docs.length} onClick={() => void revalidate(docs)}>Revalidate all</Button>
    <DataTable caption="Batches" loading={loading} rows={docs} rowKey={b => b.batch.batch_id} columns={[
      { key: 'batch', label: 'Batch', render: b => <a href={workspaceHref(b)}>{b.source_files[0]?.filename ?? b.batch.batch_id}</a> },
      { key: 'validation', label: 'Integrity', render: b => validateBatch(b).errors.map(e => `${e.code}: ${e.message}`).join('; ') || 'Valid' },
      { key: 'action', label: 'Action', render: b => <Button disabled={busy || loading} onClick={() => void revalidate([b])}>Revalidate</Button> },
    ]} />
    <DataTable caption="Open issues by rule" rows={groups} rowKey={g => g.code} columns={[
      { key: 'rule', label: 'Rule', render: g => <Button variant="ghost" onClick={() => { setRule(g.code); setStatus('open'); }}>{issueTitle(g.code)}</Button> },
      { key: 'count', label: 'Count', render: g => g.count },
      { key: 'batches', label: 'Affected batches', render: g => <>{g.batches.length} {g.batches.map(b => <a key={b.batch.batch_id} href={workspaceHref(b)}>{b.source_files[0]?.filename ?? b.batch.batch_id} </a>)}</> },
    ]} />
    <h2>Issues</h2><div className="ds-grid">
      <Field label="Severity"><Select value={severity} onChange={e => setSeverity(e.target.value)}><option value="">All severities</option>{severities.map(s => <option key={s}>{s}</option>)}</Select></Field>
      <Field label="Rule"><Select value={rule} onChange={e => setRule(e.target.value)}><option value="">All rules</option>{[...new Set(all.map(r => r.issue.rule_code))].sort().map(code => <option key={code} value={code}>{code}</option>)}</Select></Field>
      <Field label="Batch"><Select value={batchId} onChange={e => setBatchId(e.target.value)}><option value="">All batches</option>{docs.map(b => <option key={b.batch.batch_id} value={b.batch.batch_id}>{b.source_files[0]?.filename ?? b.batch.batch_id}</option>)}</Select></Field>
      <Field label="Status"><Select value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{['open', 'waived', 'resolved'].map(s => <option key={s}>{s}</option>)}</Select></Field>
    </div>
    <DataTable caption="Validation issues" loading={loading} rows={rows} rowKey={r => `${r.batch.batch.batch_id}/${r.issue.issue_id}`} emptyMessage="No matching issues" columns={[
      { key: 'rule', label: 'Rule', render: r => issueTitle(r.issue.rule_code) },
      { key: 'severity', label: 'Severity', render: r => <StatusPill tone={r.issue.severity === 'blocking' || r.issue.severity === 'error' ? 'danger' : r.issue.severity === 'warning' ? 'warning' : 'info'}>{readable(r.issue.severity)}</StatusPill> },
      { key: 'message', label: 'Message', render: r => <a href={issueHref(r.batch, r.issue)}>{r.issue.message}</a> },
      { key: 'status', label: 'Status', render: r => readable(r.issue.status) },
      { key: 'action', label: 'Review', render: r => ruleCatalogEntry(r.issue.rule_code)?.waivable ? r.issue.status !== 'resolved' && <Button disabled={busy} onClick={() => { setDecision(r); setReason(''); }}>{r.issue.status === 'waived' ? 'Reopen' : 'Waive'}</Button> : <span>Cannot waive mandatory integrity or extraction rules</span> },
    ]} />
    <h2>Rule catalog</h2><Field label="Search rules"><Input value={search} onChange={e => setSearch(e.target.value)} /></Field>
    <DataTable caption="Rules" rows={RULE_CATALOG.filter(r => `${r.code} ${r.title} ${r.description}`.toLowerCase().includes(search.toLowerCase()))} rowKey={r => r.code} columns={[
      { key: 'code', label: 'Code', render: r => <Button variant="ghost" onClick={() => setSelected(r.code)}>{r.code}</Button> },
      { key: 'title', label: 'Title', render: r => r.title },
      { key: 'severity', label: 'Severity', render: r => <StatusPill tone={r.severity === 'blocking' || r.severity === 'error' ? 'danger' : r.severity === 'warning' ? 'warning' : 'info'}>{readable(r.severity)}</StatusPill> },
    ]} />
    <section aria-label="Rule details"><h3>{detail.title}</h3><p>{detail.description}</p><p>How to fix: {detail.howToFix}</p><p>Scope: {detail.scope} · Waivable: {detail.waivable ? 'Yes, with a documented reason' : 'No'} · Automatically resolves: {detail.autoResolves ? 'Yes' : 'No'}</p></section>
    <Dialog open={!!decision} onClose={() => { if (!busy) setDecision(undefined); }} title={decision?.issue.status === 'waived' ? 'Reopen issue' : 'Waive issue'}><Field label="Waiver reason" hint="At least 10 characters. The decision is recorded in the review history."><Input value={reason} onChange={e => setReason(e.target.value)} /></Field><Button disabled={busy || reason.trim().length < 10} onClick={() => void saveDecision()}>{decision?.issue.status === 'waived' ? 'Save reopen' : 'Save waiver'}</Button></Dialog>
  </section>;
}
