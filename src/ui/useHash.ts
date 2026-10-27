import { useEffect, useState } from 'react';

export type Route = { name: 'home' | 'documents' | 'review' | 'settings' | 'design' | 'notfound' | 'labels' | 'templates' | 'explorer' | 'agents' | 'validation' } | { name: 'doc'; id: string; transactionId?: string };

/** Studio pages: hash segment -> route name. */
export const STUDIO_ROUTES: Record<string, 'labels' | 'templates' | 'explorer' | 'agents' | 'validation'> = { 'label-studio': 'labels', templates: 'templates', 'json-explorer': 'explorer', 'ai-agents': 'agents', validation: 'validation' };

export function parse(hash: string): Route {
  if (hash === '' || hash === '#' || hash === '#/') return { name: 'home' };
  if (!hash.startsWith('#/')) return { name: 'notfound' };
  const p = hash.slice(2).split('/');
  if (p.length === 1 && ['documents', 'review', 'settings', 'design'].includes(p[0])) return { name: p[0] as 'documents' | 'review' | 'settings' | 'design' };
  if (p.length === 1 && Object.hasOwn(STUDIO_ROUTES, p[0])) return { name: STUDIO_ROUTES[p[0]] };
  if (p[0] === 'doc' && p[1] && p.length <= 3 && (p.length === 2 || p[2])) {
    try { return { name: 'doc', id: decodeURIComponent(p[1]), transactionId: p[2] ? decodeURIComponent(p[2]) : undefined }; }
    catch { return { name: 'notfound' }; }
  }
  return { name: 'notfound' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (hash: string) => {
  location.hash = hash;
};
