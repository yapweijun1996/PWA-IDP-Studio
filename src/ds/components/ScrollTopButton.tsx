import { useEffect, useState } from 'react';
import { IconButton } from './IconButton';

export function ScrollTopButton({ visible }: { visible: boolean }) {
  const [bottom, setBottom] = useState<number>();
  useEffect(() => {
    if (!visible) return;
    const resize = new ResizeObserver(() => measure());
    const measure = () => {
      const toasts = [...document.querySelectorAll('.ds-toast')];
      toasts.forEach(toast => resize.observe(toast));
      const top = Math.min(window.innerHeight, ...toasts.map(toast => toast.getBoundingClientRect().top));
      setBottom(top < window.innerHeight ? window.innerHeight - top + 16 : undefined);
    };
    const mutations = new MutationObserver(measure);
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', measure); measure();
    return () => { resize.disconnect(); mutations.disconnect(); window.removeEventListener('resize', measure); };
  }, [visible]);
  if (!visible) return null;
  return <IconButton className="ds-scroll-top" style={bottom === undefined ? undefined : { bottom: `max(${bottom}px, env(safe-area-inset-bottom))` }} icon="arrow-up" label="Scroll to top" onClick={() => {
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    window.scrollTo({ top: 0, behavior });
  }} />;
}
