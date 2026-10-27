import { useMemo, useState } from 'react';
import type { Batch } from '../../contract/types';
import type { Settings } from '../../lib/settings';
import { exportEligibleTransactions, validateBatch } from '../../contract/validate';
import { copyJSONText, downloadJSON, serializeJSON, transactionJSONValue } from '../../lib/jsonExport';
import { Button, Card, EmptyState, Field, JsonTree, Notice, PageHeader, Select, StatusPill, Tabs } from '../../ds';
import { workspaceHref } from '../nav';

export interface StudioPageProps { docs: Batch[]; settings: Settings; loading?: boolean; refresh: () => Promise<void> }
const scopes = ['Full batch', 'Transaction', 'Evidence', 'Issues', 'Reviews', 'Validation'];
function BatchExplorer({ batch }: { batch: Batch }) {
  const [scope, setScope] = useState('Full batch');
  const [selectedTxId, setTxId] = useState(batch.transactions[0]?.transaction_id ?? '');
  const txId = (batch.transactions.find(tx => tx.transaction_id === selectedTxId) ?? batch.transactions[0])?.transaction_id ?? '';
  const [pointer, setPointer] = useState('');
  const [message, setMessage] = useState('');
  const [manualCopy, setManualCopy] = useState(false);
  const validation = useMemo(() => validateBatch(batch), [batch]);
  const full = useMemo(() => serializeJSON(batch), [batch]);
  const eligible = useMemo(() => validation.ok ? exportEligibleTransactions(batch) : [], [batch, validation]);
  const size = useMemo(() => {
    let nodes = 0; const stack: unknown[] = [batch];
    while (stack.length) { const value = stack.pop(); nodes++; if (value !== null && typeof value === 'object') for (const child of Object.values(value)) stack.push(child); }
    return { bytes: new TextEncoder().encode(full).byteLength, nodes };
  }, [batch, full]);
  const value = useMemo(() => {
    if (scope === 'Full batch') return batch;
    if (scope === 'Transaction') return txId ? transactionJSONValue(batch, txId) : null;
    if (scope === 'Validation') return batch.validation;
    if (scope === 'Evidence') return batch.evidence;
    if (scope === 'Issues') return batch.issues;
    return batch.reviews;
  }, [batch, scope, txId]);
  let evidenceTransaction: string | undefined;
  if (scope === 'Transaction') {
    if (batch.evidence.some(e => e.transaction_id === txId && e.field_pointer === pointer)) evidenceTransaction = txId;
  } else if (scope === 'Full batch') {
    const match = /^\/transactions\/(\d+)\/data(\/.*)?$/.exec(pointer);
    const tx = match ? batch.transactions[Number(match[1])] : undefined;
    if (tx && batch.evidence.some(e => e.transaction_id === tx.transaction_id && e.field_pointer === (match?.[2] ?? ''))) evidenceTransaction = tx.transaction_id;
  }
  return <div className="ds-sheet"><Card>
    <div className="ds-row">
      <Button disabled={scope === 'Transaction' && !txId} onClick={() => downloadJSON(`${batch.batch.batch_id}.json`, full)}>Download full JSON</Button>
      <Button onClick={() => {
        setManualCopy(false); setMessage('Copying full JSON…');
        void copyJSONText(full).then(() => setMessage('Full JSON copied.'), () => {
          setManualCopy(true); setMessage('Full JSON copy unavailable. Select the text below and copy manually.');
        });
      }}>Copy full JSON</Button>
    </div>
    <p role="status">{message}</p>
    {manualCopy && <pre aria-label="Manual full JSON copy" className="ds-json" tabIndex={0}>{full}</pre>}
    <p>schema_version: {batch.schema_version} · {size.bytes.toLocaleString()} bytes · {size.nodes.toLocaleString()} nodes</p>
    <p>Export-eligible transaction ids: {eligible.join(', ') || 'None'}</p>
    <p className="ds-muted">Read-only inspection. Downloads include unapproved data; eligibility is reported, not bypassed in Workspace.</p>
  </Card>
    <Card><h2>Validation</h2><StatusPill tone={validation.ok ? 'success' : 'danger'} icon={validation.ok ? 'check' : 'alert'}>{validation.ok ? 'Valid' : 'Invalid'}</StatusPill>{[...validation.errors, ...validation.warnings].map((entry, i) => <Notice key={i} tone={'severity' in entry ? 'warning' : 'error'}><strong>{entry.code}</strong> {entry.path} {entry.message}</Notice>)}</Card>
    <Tabs label="JSON scope" value={scope} onChange={next => { setScope(next); setPointer(''); }} items={scopes.map(id => ({
      id, label: id, content: id === scope ? <div className="ds-sheet">
        {id === 'Transaction' && txId && <Field label="Transaction"><Select value={txId} onChange={e => { setTxId(e.target.value); setPointer(''); }}>{batch.transactions.map(tx => <option key={tx.transaction_id} value={tx.transaction_id}>{tx.transaction_id}</option>)}</Select></Field>}
        {id === 'Transaction' && !txId
          ? <EmptyState title="No transactions" description="This batch has no extracted transactions." />
          : <JsonTree key={`${scope}:${txId}`} value={value} expandTopLevel onFocus={path => setPointer(path)} />}
        {evidenceTransaction && <a href={workspaceHref(batch, evidenceTransaction)}>Open evidence in Workspace</a>}
      </div> : null,
    }))} />
  </div>;
}
export function JsonExplorer({ docs, loading }: StudioPageProps) {
  const [batchId, setBatchId] = useState('');
  const selected = docs.find(b => b.batch.batch_id === batchId) ?? docs[0];
  return <section className="ds-sheet"><PageHeader title="JSON Explorer" breadcrumb={<><a href="#/">Home</a> / JSON Explorer</>} description="Read-only batch JSON and transaction export inspection." />{loading ? <Notice>Loading stored batches…</Notice> : !selected ? <EmptyState title="No stored batches" description="Upload a document to inspect its JSON." /> : <><Field label="Batch"><Select value={selected.batch.batch_id} onChange={e => setBatchId(e.target.value)}>{docs.map(batch => <option key={batch.batch.batch_id} value={batch.batch.batch_id}>{batch.source_files.map(f => f.filename).join(', ')} · {batch.batch.batch_id}</option>)}</Select></Field><BatchExplorer key={selected.batch.batch_id} batch={selected} /></>}</section>;
}
