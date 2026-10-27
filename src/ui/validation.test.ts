import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { buildBatch } from '../contract/build';
import { invoiceInput } from '../contract/fixtures';
import { loadSettings } from '../lib/settings';
import { ValidationPage } from './pages/ValidationPage';
vi.mock('../lib/db', () => ({ putBatch: vi.fn(async () => {}) }));
it('filters cross-batch issues and exposes only safe waiver actions', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const input = invoiceInput(); input.output.fields = input.output.fields.filter(f => f.key !== 'supplier_name');
  const batch = buildBatch(input);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ValidationPage, { docs: [batch], settings: loadSettings(), refresh: async () => {} })));
    const select = container.querySelectorAll('select')[1];
    await act(async () => { select.value = 'MISSING_REQUIRED'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const region = container.querySelector('[aria-label="Validation issues"]')!;
    expect(region.textContent).toContain('/supplier_name: required field is missing.');
    expect(region.textContent).toContain('Cannot waive');
    expect(region.querySelector('a')?.getAttribute('href')).toContain('/t_1');
    expect([...region.querySelectorAll('button')].some(b => b.textContent === 'Waive')).toBe(false);
    await act(async () => { select.value = 'LOW_CONFIDENCE'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    const waive = [...region.querySelectorAll('button')].find(b => b.textContent === 'Waive')!;
    await act(async () => waive.click());
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Waiver reason');
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Save waiver')?.disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});
