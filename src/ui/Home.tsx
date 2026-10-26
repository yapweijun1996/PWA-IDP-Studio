import { useRef, useState } from 'react';
import { providerInfo } from '../lib/providers';
import { isSupported } from '../lib/pdf';
import type { Settings } from '../lib/settings';
import type { Batch } from '../contract/types';
import { go } from './useHash';
import { Icon } from './Icon';

const label = (d: Batch) =>
  d.batch.status === 'processing' ? 'Processing…' : d.batch.status === 'failed' ? 'Failed' : d.batch.status.replace(/_/g, ' ');

export function Home(props: {
  docs: Batch[];
  settings: Settings;
  busy: string | null;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [note, setNote] = useState('');
  const info = providerInfo(props.settings.provider);

  const accept = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    const ok = files.filter(isSupported);
    setNote(
      ok.length < files.length
        ? 'Some files were skipped. Supported: PDF, PNG, JPG (WebP and TIFF are not supported by this contract yet).'
        : '',
    );
    if (ok.length) props.onFiles(ok);
  };

  return (
    <section className="page">
      <header className="hero">
        <h1>Drop your documents here</h1>
        <p className="muted">Upload invoices, orders, receipts, forms or other business documents.</p>
      </header>

      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          accept(e.dataTransfer.files);
        }}
      >
        <Icon name="upload" size="lg" />
        <p>Drag &amp; drop, or</p>
        <button className="btn primary" onClick={() => input.current?.click()}>
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="application/pdf,image/png,image/jpeg"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = '';
          }}
        />
        <small className="muted">PDF, PNG, JPG • multiple files • up to {props.settings.maxPages} pages sent per file; remaining pages require review</small>
      </div>
      {note && <p role="alert" className="warn">{note}</p>}
      <p className="muted disclosure">
        Pages are sent to <strong>{info.recipient}</strong>. <a href="#/settings">Change provider</a>
      </p>
      {props.busy && <p role="status">{props.busy}</p>}

      <h2>Recent Documents</h2>
      {props.docs.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <ul className="docs">
          {props.docs.slice(0, 20).map((d) => (
            <li key={d.batch.batch_id}>
              <a href={`#/doc/${d.batch.batch_id}`} onClick={() => go(`#/doc/${d.batch.batch_id}`)}>
                <Icon name="document" />
                <strong>{d.source_files[0].filename}</strong>
                <span className="muted">{d.documents[0]?.document_type.replace(/_/g, ' ') ?? 'Unclassified'} · {d.pages.length} pages · {d.documents.length} documents · {d.transactions.length} transactions</span>
                <span className={`badge ${d.batch.status}`}>
                  {(d.batch.status === 'validated' || d.batch.status === 'approved') && <Icon name="check" size="sm" />}
                  {(d.batch.status === 'review_required' || d.batch.status === 'failed') && <Icon name="alert" size="sm" />}
                  {label(d)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
