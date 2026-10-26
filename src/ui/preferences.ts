import { useState } from 'react';
export interface Preferences { pageSize: number; density: 'comfortable' | 'compact' }
export function loadPreferences(): Preferences {
  try { const p = JSON.parse(localStorage.getItem('idp-studio.tables') ?? '{}'); return { pageSize: [10, 25, 50].includes(p.pageSize) ? p.pageSize : 10, density: p.density === 'compact' ? 'compact' : 'comfortable' }; } catch { return { pageSize: 10, density: 'comfortable' }; }
}
export function usePreferences() {
  const [preferences, update] = useState(loadPreferences);
  return { preferences, setPreferences: (p: Preferences) => { update(p); try { localStorage.setItem('idp-studio.tables', JSON.stringify(p)); } catch { /* Session only when storage is blocked. */ } } };
}
