import { useRef, useState } from 'react';
import { providerInfo } from '../lib/providers';
import { isSupported } from '../lib/pdf';
import type { Settings } from '../lib/settings';
import type { DocumentRecord } from '../lib/types';
import { go } from './useHash';
import { Icon } from './Icon';

const label = (d: DocumentRecord) =>
  d.envelope.status === 'processing' ? 'Processing…' : d.envelope.status === 'failed' ? 'Failed' : d.envelope.status.replace('_', ' ');

export function Home(props: {
  docs: DocumentRecord[];
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
        ? 'Some files were skipped. Supported: PDF, PNG, JPG, WebP (TIFF is not supported yet).'
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
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => {
            accept(e.target.files);
            e.target.value = '';
          }}
        />
        <small className="muted">PDF, PNG, JPG, WebP • multiple files • up to 6 pages each</small>
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
            <li key={d.id}>
              <a href={`#/doc/${d.id}`} onClick={() => go(`#/doc/${d.id}`)}>
                <Icon name="document" />
                <strong>{d.name}</strong>
                <span className="muted">{d.envelope.document_type.replace(/_/g, ' ')}</span>
                <span className={`badge ${d.envelope.status}`}>
                  {(d.envelope.status === 'ready' || d.envelope.status === 'approved') && <Icon name="check" size="sm" />}
                  {(d.envelope.status === 'review_required' || d.envelope.status === 'failed') && <Icon name="alert" size="sm" />}
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
