import { useEffect, useRef, type RefObject } from 'react';
const selector = 'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]';
let locks = 0;
let previousOverflow = '';
/** Shared dialog/drawer focus trap with nested scroll-lock accounting. */
export function useModalFocus(open: boolean, ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    if (locks++ === 0) { previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
    const root = ref.current;
    // Preserve tab order even when a selector engine groups matches by selector.
    const candidates = () => Array.from(root?.querySelectorAll<HTMLElement>(selector) ?? []).filter(node => !node.closest('[hidden]')).sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    (candidates()[0] ?? root)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key === 'Tab') { const nodes = candidates(); const first = nodes[0]; const last = nodes.at(-1); if (!first) { event.preventDefault(); root?.focus(); } else if (event.shiftKey && (document.activeElement === first || !root?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && (document.activeElement === last || !root?.contains(document.activeElement))) { event.preventDefault(); first.focus(); } }
    };
    const focusin = (event: FocusEvent) => { if (root && !root.contains(event.target as Node)) (candidates()[0] ?? root).focus(); };
    document.addEventListener('keydown', keydown); document.addEventListener('focusin', focusin);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin); if (--locks === 0) document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, [open, ref]);
}
