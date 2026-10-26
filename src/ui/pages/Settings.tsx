import { useState } from 'react';
import { PROVIDERS, providerInfo } from '../../lib/providers';
import { clampMaxPages, DEFAULT_MODELS, loadSettings, saveSettings, type Settings } from '../../lib/settings';
import type { ProviderId } from '../../lib/types';
import { Button, Card, Dialog, Field, Input, PageHeader, Segmented, Select, Notice, useTheme, type Theme } from '../../ds';
import { usePreferences } from '../preferences';
import { clearLocalData } from '../storage';
import { APP_VERSION, BUILD_ID } from '../version';
export function SettingsPage({ settings, onChange, migration, batchCount = 0, onCleared }: { settings: Settings; onChange: (s: Settings) => void; migration?: { migrated: number; skipped: number }; batchCount?: number; onCleared?: () => void | Promise<void> }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  const { preferences, setPreferences } = usePreferences();
  const [sidebar, setSidebar] = useState(() => { try { return localStorage.getItem('idp-studio.sidebar') ?? 'expanded'; } catch { return 'expanded'; } });
  const info = providerInfo(s.provider);
  const { theme, setTheme } = useTheme();
  const set = (patch: Partial<Settings>) => { setS({ ...s, ...patch }); setSaved(false); };
  return <section className="ds-sheet">
    <PageHeader title="Settings" breadcrumb={<><a href="#/">Home</a> / Settings</>} description="Preferences, credentials and uploads stay in this browser." />
    <Card><h2>General</h2><Field label="Maximum pages per extraction" hint="1–500. Pages beyond this limit are not processed and block export."><Input type="number" min={1} max={500} value={s.maxPages} onChange={e => set({ maxPages: clampMaxPages(e.target.value) })} /></Field>
      <Field label="Default page size"><Select value={preferences.pageSize} onChange={e => setPreferences({ ...preferences, pageSize: Number(e.target.value) })}>{[10,25,50].map(n => <option key={n} value={n}>{n}</option>)}</Select></Field>
      <Segmented label="Table density" value={preferences.density} onChange={value => setPreferences({ ...preferences, density: value as 'comfortable' | 'compact' })} options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]} />
    </Card>
    <Card><h2>AI provider</h2><Segmented label="AI provider" value={s.provider} onChange={value => set({ provider: value as ProviderId })} options={PROVIDERS.map(provider => ({ value: provider.id, label: provider.label }))} /><p className="ds-muted">Pages are sent to {info.recipient}.</p>
      {info.needsKey && <Field label={`${info.label} API key`} hint={`Stored in this browser; sent only to ${info.recipient}.`}><Input type="password" autoComplete="off" value={s.keys[s.provider as Exclude<ProviderId, 'demo'>] ?? ''} onChange={e => set({ keys: { ...s.keys, [s.provider]: e.target.value } })} /></Field>}
      <Field label="Model"><Input value={s.models[s.provider] ?? ''} placeholder={DEFAULT_MODELS[s.provider]} onChange={e => set({ models: { ...s.models, [s.provider]: e.target.value } })} /></Field>
      <Button variant="primary" onClick={() => { saveSettings(s); onChange(s); setSaved(true); }}>Save extraction settings</Button>{saved && <Notice>Saved for this session. Browser persistence is used when available.</Notice>}
    </Card>
    <Card><h2>Appearance</h2><Segmented label="Theme" value={theme} onChange={value => setTheme(value as Theme)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /><Segmented label="Sidebar default" value={sidebar} onChange={value => { setSidebar(value); try { localStorage.setItem('idp-studio.sidebar', value); } catch { /* Session only. */ } }} options={[{ value: 'expanded', label: 'Expanded' }, { value: 'collapsed', label: 'Collapsed' }]} /><p className="ds-muted">Sidebar default applies on the next app load. The menu toggle changes the current layout.</p></Card>
    <Card><h2>Data &amp; Storage</h2><p>{batchCount} batches stored in this browser.</p><p>{migration ? `v1 migration: ${migration.migrated} migrated, ${migration.skipped} skipped (missing or unsupported originals). Legacy records are retained.` : 'Checking legacy records…'}</p><Button variant="danger" onClick={() => setConfirm(true)}>Clear all local data</Button>{error && <Notice tone="error">{error}</Notice>}</Card>
    <Card><h2>About</h2><p>Version {APP_VERSION} · Build {BUILD_ID}</p><a href="#/design">Design system component sheet</a></Card>
    <Dialog open={confirm} onClose={() => !clearing && setConfirm(false)} title="Clear all local data?">
      <p>This deletes all local batches, original files, legacy documents, review history, provider API keys, extraction settings, theme, sidebar and table preferences from this browser. Data held by providers and unrelated browser data are not deleted.</p>
      <Button disabled={clearing} onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" disabled={clearing} onClick={async () => { setClearing(true); try { await clearLocalData(); const defaults = loadSettings(); setS(defaults); onChange(defaults); setPreferences({ pageSize: 10, density: 'comfortable' }); setTheme('light'); setSidebar('expanded'); await onCleared?.(); setConfirm(false); } catch (e) { setError(String(e)); } finally { setClearing(false); } }}>Delete all local data</Button>
    </Dialog>
  </section>;
}
