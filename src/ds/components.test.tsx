import { act, useCallback, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from './theme';
import { Sidebar } from './components/Sidebar';
import { DataTable } from './components/DataTable';
import { Dialog } from './components/Dialog';
import { Tooltip } from './components/Tooltip';
import { Dropzone } from './components/Dropzone';
import { AppShell } from './components/AppShell';
let container: HTMLDivElement;
let root: Root;
let dark = false;
let mediaListeners: Set<() => void>;
const render = (node: ReactNode) => act(() => root.render(node));
const click = (node: Element) => act(() => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); dark = false; mediaListeners = new Set();
  vi.stubGlobal('matchMedia', (query: string) => ({ get matches() { return query.includes('prefers-color') && dark; }, media: query, addEventListener: (_: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_: string, fn: () => void) => mediaListeners.delete(fn) }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function ThemeControls() { const { theme, setTheme } = useTheme(); return <button onClick={() => setTheme(theme === 'dark' ? 'system' : 'dark')}>{theme}</button>; }
describe('theme', () => {
  it('restores persisted choice and follows system changes only in system mode', () => { localStorage.setItem('idp-studio.theme', 'dark'); render(<ThemeProvider><ThemeControls /></ThemeProvider>); expect(document.documentElement.dataset.theme).toBe('dark'); click(container.querySelector('button')!); expect(localStorage.getItem('idp-studio.theme')).toBe('system'); expect(document.documentElement.dataset.theme).toBe('light'); act(() => { dark = true; mediaListeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe('dark'); });
  it('defaults to light and persists an explicit choice', () => { render(<ThemeProvider><ThemeControls /></ThemeProvider>); expect(document.documentElement.dataset.theme).toBe('light'); click(container.querySelector('button')!); expect(localStorage.getItem('idp-studio.theme')).toBe('dark'); act(() => { dark = false; mediaListeners.forEach(fn => fn()); }); expect(document.documentElement.dataset.theme).toBe('dark'); });
});
it('sidebar toggles aria-expanded and restores persisted rail state', () => { const items = [{ href: '#/', label: 'Home', icon: 'home' as const, active: true }]; render(<Sidebar items={items} />); const toggle = container.querySelector('button')!; expect(toggle.getAttribute('aria-expanded')).toBe('true'); click(toggle); expect(toggle.getAttribute('aria-expanded')).toBe('false'); expect(localStorage.getItem('idp-studio.sidebar')).toBe('collapsed'); render(<div />); render(<Sidebar items={items} />); expect(container.querySelector('button')!.getAttribute('aria-expanded')).toBe('false'); expect(container.querySelector('a')!.getAttribute('aria-current')).toBe('page'); });
const rows = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
const columns = [{ key: 'name', label: 'Name', render: (row: typeof rows[number]) => row.name, sortValue: (row: typeof rows[number]) => row.name }];
it('table sorts with aria-sort and activates rows with pointer and Enter', () => { const select = vi.fn(); render(<DataTable caption="Files" rows={rows} columns={columns} rowKey={row => row.id} onRowClick={select} selectedKey="a" />); click(container.querySelector('th button')!); expect(container.querySelector('th')!.getAttribute('aria-sort')).toBe('ascending'); expect(container.querySelector('tbody td')!.textContent).toBe('Alpha'); const row = container.querySelector('tbody tr')!; click(row); act(() => { row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }); expect(select.mock.calls).toEqual([[rows[1]], [rows[1]]]); expect(row.getAttribute('aria-selected')).toBe('true'); click(container.querySelector('th button')!); expect(container.querySelector('th')!.getAttribute('aria-sort')).toBe('descending'); expect(container.querySelector('tbody td')!.textContent).toBe('Beta'); });
it('table exposes empty loading and error states', () => { render(<DataTable caption="Files" rows={[]} columns={columns} rowKey={row => row.id} />); expect(container.textContent).toContain('No records'); render(<DataTable caption="Files" rows={[]} columns={columns} rowKey={row => row.id} loading />); expect(container.querySelector('[role="status"]')!.textContent).toContain('Loading Files'); render(<DataTable caption="Files" rows={[]} columns={columns} rowKey={row => row.id} error="Access denied" />); expect(container.querySelector('[role="alert"]')!.textContent).toContain('Access denied'); });
function DialogExample() { const [open, setOpen] = useState(false); const close = useCallback(() => setOpen(false), []); return <><button onClick={() => setOpen(true)}>Open</button><Dialog open={open} onClose={close} title="Edit"><input aria-label="Name" /><button>Save</button></Dialog></>; }
it('dialog traps focus, closes on Escape and returns focus', () => { render(<DialogExample />); const trigger = container.querySelector('button')!; trigger.focus(); click(trigger); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(document.body.style.overflow).toBe('hidden'); const close = document.querySelector<HTMLButtonElement>('[aria-label="Close dialog"]')!; expect(document.activeElement).toBe(close); act(() => { close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); }); expect(document.activeElement?.textContent).toBe('Save'); act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(trigger); expect(document.body.style.overflow).not.toBe('hidden'); });
it('tooltip opens on focus and dismisses on Escape', () => { render(<Tooltip text="Useful help"><button>Help</button></Tooltip>); const trigger = container.querySelector('button')!; act(() => trigger.focus()); expect(container.querySelector('[role="tooltip"]')!.textContent).toBe('Useful help'); act(() => { trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); expect(container.querySelector('[role="tooltip"]')).toBeNull(); });
it('dropzone filters chooser files by extension and MIME and respects multiple', () => { const report = vi.fn(); render(<Dropzone accept=".pdf,image/*" multiple onFiles={report} />); const input = container.querySelector('input')!; const pdf = new File(['pdf'], 'invoice.PDF', { type: 'application/pdf' }); const image = new File(['png'], 'scan.png', { type: 'image/png' }); const text = new File(['txt'], 'notes.txt', { type: 'text/plain' }); Object.defineProperty(input, 'files', { configurable: true, value: [pdf, text, image] }); act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); }); expect(report).toHaveBeenCalledWith([pdf, image]); expect(container.querySelector('[role="status"]')!.textContent).toContain('not accepted'); render(<Dropzone accept=".pdf" onFiles={report} />); Object.defineProperty(container.querySelector('input')!, 'files', { configurable: true, value: [pdf, pdf] }); act(() => { container.querySelector('input')!.dispatchEvent(new Event('change', { bubbles: true })); }); expect(report.mock.calls.at(-1)).toEqual([[pdf]]); });

it('mobile drawer traps focus and restores the topbar trigger after Escape', () => {
  let mobile = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query.includes('max-width') && mobile; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  render(<AppShell items={[{ href: '#/', label: 'Home', icon: 'home' }]}><p>Content</p></AppShell>);
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Toggle navigation"]')!;
  act(() => { mobile = true; listeners.forEach(listener => listener()); });
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  trigger.focus();
  click(trigger);
  const drawer = container.querySelector('aside')!;
  expect(drawer.getAttribute('aria-modal')).toBe('true');
  expect(document.body.style.overflow).toBe('hidden');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Close navigation');
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(drawer.hidden).toBe(true);
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).not.toBe('hidden');
});

it('tooltip description is attached to the focused trigger', () => {
  render(<Tooltip text="Explains the action"><button>Action</button></Tooltip>);
  const trigger = container.querySelector('button')!;
  act(() => trigger.focus());
  const tooltip = container.querySelector('[role="tooltip"]')!;
  expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
});
