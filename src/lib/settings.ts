import type { ProviderId } from './types';

export interface Settings {
  provider: ProviderId;
  keys: Partial<Record<Exclude<ProviderId, 'demo'>, string>>;
  models: Partial<Record<ProviderId, string>>;
  maxPages: number;
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  demo: 'demo-auto',
  openai: 'gpt-5.4-mini',
  openrouter: 'google/gemini-2.5-flash',
  gemini: 'gemini-2.5-flash',
};

const KEY = 'idp-studio.settings.v1';
const fresh = (): Settings => ({ provider: 'demo', keys: {}, models: {}, maxPages: 20 });

export function clampMaxPages(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(500, Math.max(1, Math.floor(n))) : 20;
}

/** BYOK keys stay in this browser's localStorage and are only sent to the chosen provider. */
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const stored = JSON.parse(raw);
    return { ...fresh(), ...stored, maxPages: stored.maxPages === undefined ? 20 : clampMaxPages(stored.maxPages) };
  } catch {
    return fresh();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...s, maxPages: clampMaxPages(s.maxPages) }));
  } catch {
    /* storage blocked: settings last for this session only */
  }
}

export const modelFor = (s: Settings, p: ProviderId) => s.models[p]?.trim() || DEFAULT_MODELS[p];
