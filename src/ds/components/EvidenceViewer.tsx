import { useEffect, useState } from 'react';
import { Button } from './Button';
import { IconButton } from './IconButton';
import { Notice } from './Notice';
export interface EvidenceBox { id: string; label: string; x: number; y: number; width: number; height: number }
/** Read-only normalized evidence. Geometry is never interactive or editable. */
export function EvidenceViewer({ pages, page, onPageChange, boxes = [], selected, error }: { pages: readonly { number: number; src?: string; pending?: boolean }[]; page: number; onPageChange: (page: number) => void; boxes?: readonly EvidenceBox[]; selected?: string; error?: string }) {
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(true);
  useEffect(() => { if (selected) setExpanded(true); }, [selected, page]);
  const current = pages.find(p => p.number === page);
  const index = pages.findIndex(p => p.number === page);
  return <section className="ds-evidence-viewer" aria-label="Document viewer">
    <Button aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide' : 'Show'} document viewer</Button>
    {expanded && <><div className="ds-viewer-toolbar" role="group" aria-label="Viewer controls"><IconButton icon="chevron-left" label="Previous page" disabled={index <= 0} onClick={() => onPageChange(pages[index - 1].number)} /><span role="status">Page {index + 1} of {pages.length}</span><IconButton icon="chevron-right" label="Next page" disabled={index < 0 || index >= pages.length - 1} onClick={() => onPageChange(pages[index + 1].number)} /><IconButton icon="chevron-down" label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} /><span>{Math.round(zoom * 100)}%</span><IconButton icon="plus" label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.25))} /><IconButton icon="sliders" label="Fit width" onClick={() => setZoom(1)} /></div>
      {pages.length > 1 && <nav className="ds-row" aria-label="Page thumbnails">{pages.map(p => <Button key={p.number} aria-current={page === p.number ? 'page' : undefined} onClick={() => onPageChange(p.number)}>{p.src && !p.pending ? <img className="ds-thumbnail" src={p.src} alt="" /> : null}Page {p.number}{p.pending ? ' · not processed' : ''}</Button>)}</nav>}
      {error && <Notice tone="warning">{error}</Notice>}
      <div className="ds-viewer-scroll">{current?.pending ? <Notice tone="warning">Page {page} not processed. This page blocks export.</Notice> : current?.src ? <div className="ds-evidence-page" style={{ width: `${zoom * 100}%` }}><img src={current.src} alt={`Page ${page}`} />{boxes.map(box => <div key={box.id} role="img" aria-label={`${box.label}${selected === box.id ? ' (selected)' : ''} — read-only evidence`} data-testid={selected === box.id ? 'bbox' : undefined} className={`ds-evidence-box ${selected === box.id ? 'ds-evidence-selected' : ''}`} style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` }} />)}</div> : <p>Page preview unavailable.</p>}</div>
    </>}
  </section>;
}
