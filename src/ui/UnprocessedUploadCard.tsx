import { useState } from 'react';
import type { Batch } from '../contract/types';
import { Badge, Button, Card, Notice, Progress } from '../ds';
import { DeleteUploadDialog } from './DeleteUploadDialog';

/** An upload whose pages are not all processed: says what state it is in and offers retry or removal. */
export function UnprocessedUploadCard({ batch, busy, onRetry, onDeleted }: { batch: Batch; busy: string | null; onRetry?: (batchId: string) => void; onDeleted?: () => void | Promise<void> }) {
  const [deleting, setDeleting] = useState<Batch>();
  const [error, setError] = useState('');
  const status = batch.batch.status;
  const done = batch.pages.filter(p => p.status === 'classified').length;
  const missing = batch.pages.filter(p => p.status !== 'classified').map(p => p.page_number);
  // A "processing" batch with nothing running was stopped before it finished.
  const running = status === 'processing' && !!busy;
  const interrupted = status === 'processing' && !busy;
  const state = status === 'failed' ? 'Failed' : interrupted ? 'Interrupted' : running ? 'Processing' : 'Incomplete';
  const canRetry = !!onRetry && (status === 'failed' || interrupted);
  return <Card>
    <div className="ds-row ds-card-header"><h2>{batch.source_files[0].filename}</h2><Badge tone={status === 'failed' ? 'danger' : 'warning'}>{state}</Badge></div>
    <Progress label={`Page coverage ${done} of ${batch.pages.length}${running ? ` · ${busy}` : ''}`} value={done} max={batch.pages.length} />
    {missing.length > 0 && <Notice tone="warning">{missing.length === 1 ? 'Page' : 'Pages'} {missing.join(', ')} {missing.length === 1 ? 'was' : 'were'} not processed, so export is blocked. {batch.issues.find(i => i.rule_code === 'EXTRACTION_FAILED')?.message}</Notice>}
    <div className="ds-row">
      {canRetry && <Button disabled={!!busy} onClick={() => onRetry(batch.batch.batch_id)}>Retry extraction</Button>}
      <Button variant="danger" disabled={!!busy} onClick={() => setDeleting(batch)}>Delete upload</Button>
    </div>
    {error && <Notice tone="error">{error}</Notice>}
    <DeleteUploadDialog batch={deleting} onClose={() => setDeleting(undefined)} onDeleted={onDeleted} onError={setError} />
  </Card>;
}
