import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { scrollDirection, useSmartScroll } from './useSmartScroll';
import { ScrollTopButton } from './components/ScrollTopButton';

it('accumulates directional movement, rejects jitter, and resets near top or forced visible', () => {
  expect(scrollDirection(100, 104, 0, false, false)).toEqual({ hidden: false, movement: 4 });
  expect(scrollDirection(104, 108, 4, false, false).hidden).toBe(true);
  expect(scrollDirection(108, 105, 0, true, false).hidden).toBe(true);
  expect(scrollDirection(105, 100, -3, true, false).hidden).toBe(false);
  expect(scrollDirection(100, 102, -3, true, false).movement).toBe(2);
  expect(scrollDirection(100, 48, 0, true, false).hidden).toBe(false);
  expect(scrollDirection(100, 120, 0, true, true).hidden).toBe(false);
});

it('reveals for focus and overlays and scrolls only after one viewport, respecting reduced motion', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let reduced = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const scrollTo = vi.fn(); vi.stubGlobal('scrollTo', scrollTo);
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const scrolling = document.scrollingElement || document.documentElement;
  Object.defineProperty(scrolling, 'scrollHeight', { configurable: true, value: 5000 });
  let y = 0; vi.stubGlobal('scrollY', y);
  function Sample({ forced = false }) { const state = useSmartScroll(forced); return createElement('div', { 'data-hidden': state.hidden }, createElement('header', { className: 'ds-topbar' }, createElement('input')), createElement(ScrollTopButton, { visible: state.showTop })); }
  const scroll = (value: number) => act(() => { y = value; vi.stubGlobal('scrollY', y); document.dispatchEvent(new Event('scroll')); });
  try {
    await act(async () => root.render(createElement(Sample)));
    expect(host.querySelector('[aria-label="Scroll to top"]')).toBeNull();
    scroll(1500);
    expect(host.firstElementChild?.getAttribute('data-hidden')).toBe('true');
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Scroll to top"]')!;
    act(() => button.click()); expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });
    reduced = true; act(() => button.click()); expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'instant' });
    act(() => host.querySelector('input')!.focus());
    expect(host.firstElementChild?.getAttribute('data-hidden')).toBe('false');
    act(() => host.querySelector('input')!.blur());
    scroll(1600);
    for (const role of ['dialog', 'menu']) {
      scroll(1700);
      const overlay = document.createElement('div'); overlay.setAttribute('role', role);
      await act(async () => document.body.append(overlay));
      expect(host.firstElementChild?.getAttribute('data-hidden')).toBe('false');
      await act(async () => overlay.remove());
      scroll(1600);
    }
    await act(async () => root.render(createElement(Sample, { forced: true })));
    scroll(1700); expect(host.firstElementChild?.getAttribute('data-hidden')).toBe('false');
    scroll(0); expect(host.querySelector('[aria-label="Scroll to top"]')).toBeNull();
    await act(async () => root.render(createElement(Sample, { forced: false })));
    Object.defineProperty(scrolling, 'scrollHeight', { configurable: true, value: 500 });
    scroll(100); expect(host.firstElementChild?.getAttribute('data-hidden')).toBe('false');
  } finally { act(() => root.unmount()); host.remove(); delete (scrolling as unknown as Record<string, unknown>).scrollHeight; vi.unstubAllGlobals(); }
});
