import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconButton } from './IconButton';
import { useModalFocus } from './useModalFocus';
/** Controlled modal traps focus, closes on Escape and restores the trigger. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) { const ref = useRef<HTMLDivElement>(null); const id = useId(); useModalFocus(open, ref, onClose); if (!open) return null; return createPortal(<div className="ds-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} className="ds-dialog"><header className="ds-row"><h2 id={id}>{title}</h2><IconButton icon="close" label="Close dialog" onClick={onClose} /></header>{children}</div></div>, document.body); }
