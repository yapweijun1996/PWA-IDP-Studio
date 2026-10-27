import 'fake-indexeddb/auto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { AiAgents } from './pages/AiAgents';
import { loadSettings } from '../lib/settings';
import { loadAgentConfig, saveAgentConfig } from '../lib/agentConfig';
import { listRuns, putRun } from '../lib/db';
import { clearLocalData } from './storage';
it('saves tool toggles, resets defaults and filters persisted run details', async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await clearLocalData();
  saveAgentConfig({ ...loadAgentConfig('demo'), maxTurns: 3 }, 'demo');
  await putRun({ id: 'run', batchId: 'batch', filename: 'invoice.pdf', provider: 'demo', model: 'test', mode: 'auto', started: 1, ended: 2, segmentationWindows: 0, documentsExtracted: 0, documentsFailed: 1, steps: [{ at: 1, tool: 'model', summary: 'Failed model', ok: false }], outcome: 'failed', error: 'failed' });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const click = async (label: string) => {
    const button = [...host.querySelectorAll('button')].find(b => b.textContent === label);
    expect(button, `Expected button "${label}"`).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () => { root.render(createElement(AiAgents, { docs: [], settings: loadSettings(), refresh: async () => {} })); });
    // Drain a real IndexedDB read after the effect's queued read, then flush React.
    await act(async () => { await listRuns(); });
    await click('invoice.pdf · failed');
    expect(host.querySelector('a[href="#/doc/batch"]')).not.toBeNull();
    expect(host.querySelector('ol')?.textContent).toContain('Failed model');
    const select = host.querySelector('select')!;
    await act(async () => { select.value = 'validated'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.textContent).toContain('No runs');
    expect(host.textContent).not.toContain('invoice.pdf');
    const toggle = [...host.querySelectorAll('label')].find(e => e.textContent === 'crop_zoom')!.querySelector('input')!;
    await act(async () => toggle.click()); await click('Save agent configuration');
    expect(loadAgentConfig('demo').tools.crop_zoom).toBe(false);
    expect([...document.querySelectorAll('[role="status"]')].some(e => e.textContent?.includes('saved'))).toBe(true);
    await click('Reset to defaults');
    expect(loadAgentConfig('demo')).toMatchObject({ maxTurns: 8, tools: { crop_zoom: true } });
  } finally { await act(async () => root.unmount()); host.remove(); await clearLocalData(); }
});
