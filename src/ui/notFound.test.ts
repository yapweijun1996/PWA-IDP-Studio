import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { parse } from './useHash';
import { NotFound } from './pages/NotFound';
import { UpdatePrompt } from './UpdatePrompt';

const state = vi.hoisted(() => ({ phase: 'available', lastChecked: null, message: '' }));
const check = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./updates', () => ({ updates: { start: vi.fn(), check, apply: vi.fn() }, useUpdateState: () => state }));

it('keeps home aliases and rejects unknown, malformed and extra path segments', () => {
  for (const hash of ['', '#', '#/']) expect(parse(hash)).toEqual({ name: 'home' });
  for (const hash of ['#/unknown', '#/doc', '#/doc/%', '#/doc/a/b/c', '#/settings/extra', '#//', '#/doc/a/', '#settings', 'documents']) expect(parse(hash)).toEqual({ name: 'notfound' });
  expect(parse('#/doc/a%20b/c')).toEqual({ name: 'doc', id: 'a b', transactionId: 'c' });
});
it('checks once per mount and uses the shared available prompt', () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host); check.mockClear();
  try {
    act(() => root.render(createElement('div', null, createElement(NotFound), createElement(UpdatePrompt))));
    act(() => root.render(createElement('div', null, createElement(NotFound), createElement(UpdatePrompt))));
    expect(check).toHaveBeenCalledTimes(1); expect(check).toHaveBeenCalledWith({ silent: true });
    expect(host.textContent).toContain('Page not found'); expect(host.textContent).toContain('A newer version is available');
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Go to Home', 'Documents', 'Update now']);
    state.phase = 'ready';
    act(() => root.render(createElement('div', null, createElement(NotFound), createElement(UpdatePrompt))));
    expect(host.textContent).not.toContain('Update now');
  } finally { act(() => root.unmount()); host.remove(); state.phase = 'available'; }
});
