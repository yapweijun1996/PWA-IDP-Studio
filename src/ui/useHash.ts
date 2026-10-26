import { useEffect, useState } from 'react';

export type Route = { name: 'home' | 'documents' | 'review' | 'settings' | 'design' } | { name: 'doc'; id: string; transactionId?: string };

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'documents') return { name: 'documents' };
  if (p[0] === 'review') return { name: 'review' };
  if (p[0] === 'settings') return { name: 'settings' };
  if (p[0] === 'design') return { name: 'design' };
  if (p[0] === 'doc' && p[1]) {
    try { return { name: 'doc', id: decodeURIComponent(p[1]), transactionId: p[2] ? decodeURIComponent(p[2]) : undefined }; }
    catch { return { name: 'home' }; }
  }
  return { name: 'home' };
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
