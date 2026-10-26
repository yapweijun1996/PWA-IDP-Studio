import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'settings' } | { name: 'doc'; id: string };

export function parse(hash: string): Route {
  const p = hash.replace(/^#\/?/, '').split('/');
  if (p[0] === 'settings') return { name: 'settings' };
  if (p[0] === 'doc' && p[1]) return { name: 'doc', id: decodeURIComponent(p[1]) };
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
