import { useState } from 'react';
import { PROVIDERS, providerInfo } from '../lib/providers';
import { DEFAULT_MODELS, saveSettings, type Settings } from '../lib/settings';
import type { ProviderId } from '../lib/types';
import { Button, Card, Field, Input, PageHeader, Segmented, Notice, useTheme, type Theme } from '../ds';

export function SettingsPage({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
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
      </Card>
    </section>
  );
}
