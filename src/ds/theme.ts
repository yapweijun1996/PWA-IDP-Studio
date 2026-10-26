import { createContext, createElement, useContext, useEffect, useState, type ReactNode } from 'react';
export type Theme = 'light' | 'dark' | 'system';
const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void }>({ theme: 'light', setTheme: () => {} });
/** Persists user choice; system mode follows live OS changes. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => { try { const value = localStorage.getItem('idp-studio.theme'); return value === 'dark' || value === 'system' ? value : 'light'; } catch { return 'light'; } });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    try { localStorage.setItem('idp-studio.theme', theme); } catch { /* Storage can be unavailable in private contexts. */ }
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? media.matches ? 'dark' : 'light' : theme;
      const color = getComputedStyle(document.documentElement).getPropertyValue('--topbar').trim();
      if (color) document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(meta => { meta.content = color; });
    };
    apply(); media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return createElement(ThemeContext.Provider, { value: { theme, setTheme } }, children);
}
export const useTheme = () => useContext(ThemeContext);
