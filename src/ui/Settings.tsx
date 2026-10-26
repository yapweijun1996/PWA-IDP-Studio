import { useState } from 'react';
import { PROVIDERS, providerInfo } from '../lib/providers';
import { DEFAULT_MODELS, saveSettings, type Settings } from '../lib/settings';
import type { ProviderId } from '../lib/types';

export function SettingsPage({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [s, setS] = useState(settings);
  const [saved, setSaved] = useState(false);
  const info = providerInfo(s.provider);

  const set = (patch: Partial<Settings>) => {
    setS({ ...s, ...patch });
    setSaved(false);
  };

  return (
    <section className="page narrow">
      <h1>Settings</h1>
      <fieldset>
        <legend>AI provider</legend>
        {PROVIDERS.map((p) => (
          <label key={p.id} className="radio">
            <input type="radio" name="provider" checked={s.provider === p.id} onChange={() => set({ provider: p.id })} />
            <span>
              <strong>{p.label}</strong>
              <small>Pages are sent to {p.recipient}</small>
            </span>
          </label>
        ))}
      </fieldset>

      {info.needsKey && (
        <label className="field">
          <span>{info.label} API key</span>
          <input
            type="password"
            autoComplete="off"
            value={s.keys[s.provider as Exclude<ProviderId, 'demo'>] ?? ''}
            onChange={(e) => set({ keys: { ...s.keys, [s.provider]: e.target.value } })}
          />
          <small>Stored only in this browser. Never sent anywhere except {info.recipient}.</small>
        </label>
      )}
      <label className="field">
        <span>Model</span>
        <input
          value={s.models[s.provider] ?? ''}
          placeholder={DEFAULT_MODELS[s.provider]}
          onChange={(e) => set({ models: { ...s.models, [s.provider]: e.target.value } })}
        />
      </label>
      <button
        className="btn primary"
        onClick={() => {
          saveSettings(s);
          onChange(s);
          setSaved(true);
        }}
      >
        Save
      </button>
      {saved && <span role="status" className="muted"> Saved.</span>}
    </section>
  );
}
