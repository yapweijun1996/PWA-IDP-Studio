import { useState } from 'react';
import { PROVIDERS, providerInfo } from '../lib/providers';
import { clampMaxPages, DEFAULT_MODELS, saveSettings, type Settings } from '../lib/settings';
import type { ProviderId } from '../lib/types';
import { Button, Card, Field, Input, PageHeader, Segmented, Notice, useTheme, type Theme } from '../ds';

export function SettingsPage({ settings, onChange, migration }: { settings: Settings; onChange: (s: Settings) => void; migration?: { migrated: number; skipped: number } }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const info = providerInfo(s.provider);
  const { theme, setTheme } = useTheme();

  const set = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch });
    setSaved(false);
  };

  return (
    <section className="ds-sheet">
      <PageHeader title="Settings" description="Provider credentials stay in this browser." />
      <Card>
      <h2>Appearance</h2>
      <Segmented label="Theme" value={theme} onChange={value => setTheme(value as Theme)} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
      <h2>AI provider</h2>
      <Segmented label="AI provider" value={s.provider} onChange={value => set({ provider: value as ProviderId })} options={PROVIDERS.map(provider => ({ value: provider.id, label: provider.label }))} />
      <p className="ds-muted">Pages are sent to {info.recipient}.</p>

      {info.needsKey && (
        <Field label={`${info.label} API key`} hint={`Stored only in this browser. Never sent anywhere except ${info.recipient}.`}>
          <Input
            type="password"
            autoComplete="off"
            value={s.keys[s.provider as Exclude<ProviderId, 'demo'>] ?? ''}
            onChange={(e) => set({ keys: { ...s.keys, [s.provider]: e.target.value } })}
          />
        </Field>
      )}
      <Field label="Model">
        <Input
          value={s.models[s.provider] ?? ''}
          placeholder={DEFAULT_MODELS[s.provider]}
          onChange={(e) => set({ models: { ...s.models, [s.provider]: e.target.value } })}
        />
      </Field>
      <Field label="Maximum pages per extraction" hint="1–500. Very high values send many images to the provider. Unprocessed pages remain visible and block export.">
        <Input type="number" min={1} max={500} value={s.maxPages} onChange={e => set({ maxPages: clampMaxPages(e.target.value) })} />
      </Field>
      <Button variant="primary"
        onClick={() => {
          saveSettings(s);
          onChange(s);
          setSaved(true);
        }}
      >
        Save
      </Button>
      {saved && <Notice>Saved.</Notice>}
      <h2>Data</h2>
      <p className="ds-muted">{migration ? `Legacy migration: ${migration.migrated} migrated, ${migration.skipped} skipped (missing or unsupported original files). Legacy records are retained unchanged.` : 'Checking legacy records…'}</p>
      </Card>
    </section>
  );
}
