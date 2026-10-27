import { useEffect, useState } from 'react';

export function scrollDirection(previous: number, current: number, movement: number, hidden: boolean, forced: boolean) {
  const delta = current - previous;
  const cumulative = delta === 0 ? movement : Math.sign(delta) === Math.sign(movement) ? movement + delta : delta;
  if (forced || current <= 48) return { hidden: false, movement: 0 };
  if (Math.abs(cumulative) >= 8) return { hidden: cumulative > 0, movement: 0 };
  return { hidden, movement: cumulative };
}

/** AppShell has no overflow container: its sticky header and workspace scroll with the document. */
export function useSmartScroll(forced = false) {
  const [state, setState] = useState({ hidden: false, showTop: false });
  useEffect(() => {
    let previous = 0;
    let movement = 0;
    let hidden = false;
    const target = document.scrollingElement || document.documentElement;
    const update = (event?: Event) => {
      if (event?.type === 'scroll' && event.target instanceof Element && event.target !== target) return;
      const y = Math.max(0, window.scrollY);
      const viewport = window.innerHeight;
      const bar = document.querySelector('.ds-topbar');
      const locked = forced || !!bar?.contains(document.activeElement) || !!document.querySelector('[role="dialog"], [role="menu"]');
      const next = scrollDirection(previous, y, movement, hidden, locked || target.scrollHeight <= viewport);
      previous = y; movement = next.movement; hidden = next.hidden;
      setState(old => old.hidden === hidden && old.showTop === (y > viewport) ? old : { hidden, showTop: y > viewport });
    };
    const observer = new MutationObserver(() => update());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('scroll', update, true);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    window.addEventListener('resize', update);
    update();
    return () => { observer.disconnect(); document.removeEventListener('scroll', update, true); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); window.removeEventListener('resize', update); };
  }, [forced]);
  return state;
}
