import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonTree } from './components/JsonTree';
describe('JsonTree', () => {
let host: HTMLDivElement; let root: Root;
const originalExec = Object.getOwnPropertyDescriptor(document, 'execCommand');
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals();
  if (originalExec) Object.defineProperty(document, 'execCommand', originalExec);
  else Reflect.deleteProperty(document, 'execCommand');
});
function click(label: string) { const node = [...host.querySelectorAll('button')].find(n => n.textContent === label)!; act(() => node.click()); }
function node(path: string) { return [...host.querySelectorAll<HTMLElement>('[role=treeitem]')].find(n => n.dataset.pointer === path)!; }
it('does not mount collapsed descendants and reveals arrays in pages of 100', () => {
  act(() => root.render(<JsonTree value={{ rows: Array.from({ length: 201 }, (_, id) => ({ id })) }} />));
  expect(node('/rows/0')).toBeUndefined(); act(() => node('/rows').click());
  expect(node('/rows/99')).toBeDefined(); expect(node('/rows/100')).toBeUndefined(); expect(node('/rows/0/id')).toBeUndefined();
  click('Show next 100'); expect(node('/rows/199')).toBeDefined(); expect(node('/rows/200')).toBeUndefined();
  act(() => node('/rows').click()); expect(node('/rows/0')).toBeUndefined();
});
it('optionally opens top-level containers while keeping deeper descendants lazy and arrays capped', () => {
  act(() => root.render(<JsonTree expandTopLevel value={{ 'a/b~c': { child: { leaf: true } }, rows: Array.from({ length: 201 }, (_, id) => ({ id })) }} />));
  expect(node('/a~1b~0c').getAttribute('aria-expanded')).toBe('true');
  expect(node('/a~1b~0c/child').getAttribute('aria-expanded')).toBe('false');
  expect(node('/a~1b~0c/child/leaf')).toBeUndefined();
  expect(node('/rows/99')).toBeDefined(); expect(node('/rows/100')).toBeUndefined();
  expect(node('/rows/0/id')).toBeUndefined();
  act(() => node('/rows').click()); expect(node('/rows/0')).toBeUndefined();
  act(() => node('/rows').click()); click('Show next 100');
  expect(node('/rows/199')).toBeDefined(); expect(node('/rows/200')).toBeUndefined();
});
it('escapes pointers and supports keyboard expansion, parent navigation and clipboard fallback', async () => {
  const exec = vi.fn(() => true); Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  act(() => root.render(<JsonTree value={{ 'a/b~c': { leaf: true } }} />));
  const parent = node('/a~1b~0c');
  act(() => { parent.focus(); parent.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  expect(node('/a~1b~0c/leaf')).toBeDefined();
  act(() => { node('/a~1b~0c/leaf').focus(); node('/a~1b~0c/leaf').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(document.activeElement).toBe(parent);
  await act(async () => click('Copy pointer'));
  expect(exec).toHaveBeenCalledWith('copy'); expect(host.textContent).toContain('Pointer copied.');
});
it('debounces search, finds hidden values beyond the first window and expands the match path', async () => {
  act(() => root.render(<JsonTree value={{ rows: Array.from({ length: 240 }, (_, i) => ({ invoice: i === 239 ? 'needle' : 'other' })) }} />));
  const input = host.querySelector('input')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'needle'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(host.textContent).toContain('1 matches'); click('Next match');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(node('/rows/239/invoice')).toBe(document.activeElement);
  expect(host.textContent).toContain('JSON Pointer: /rows/239/invoice');
});
it('reports a refused copy and retains the exact value for manual copying', async () => {
  Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
  vi.stubGlobal('navigator', { clipboard: { writeText: async () => { throw new Error('denied'); } } });
  act(() => root.render(<JsonTree value={{ value: 'line\nnext' }} />));
  act(() => node('/value').focus());
  await act(async () => click('Copy value'));
  expect(host.textContent).toContain('Value copy unavailable. Select the text below and copy manually.');
  expect(host.querySelector('pre')?.textContent).toBe('"line\\nnext"');
});
it('focuses control-character keys without treating pointers as CSS selectors', async () => {
  const path = '/line\n"quoted"';
  act(() => root.render(<JsonTree value={{ 'line\n"quoted"': 'value' }} />));
  act(() => {
    node('').focus();
    node('').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(document.activeElement).toBe(node(path));
});
it('cancels stale searches, matches keys and wraps in both directions', async () => {
  act(() => root.render(<JsonTree value={{ needle: 1, hidden: { needle: false } }} />));
  const input = host.querySelector('input')!;
  const search = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  search('absent'); search('needle');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(host.textContent).toContain('2 matches');
  click('Previous match');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(document.activeElement).toBe(node('/hidden/needle'));
  click('Next match');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(document.activeElement).toBe(node('/needle'));
  search('');
  await act(async () => { await vi.runAllTimersAsync(); });
  expect(host.textContent).toContain('0 matches');
  expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Next match')?.disabled).toBe(true);
});
});
