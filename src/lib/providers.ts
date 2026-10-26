import type { Model } from '@mariozechner/pi-ai';
import { modelFor, type Settings } from './settings';
import type { ProviderId } from './types';

export const DEMO_BASE = 'https://gpt.yapweijun1996.com';
const DEMO_PROJECT = 'github-pages';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** who receives the document pages */
  recipient: string;
  needsKey: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'demo', label: 'Demo endpoint', recipient: 'gpt.yapweijun1996.com (demo gateway, shared quota)', needsKey: false },
  { id: 'openai', label: 'OpenAI (BYOK)', recipient: 'api.openai.com', needsKey: true },
  { id: 'openrouter', label: 'OpenRouter (BYOK)', recipient: 'openrouter.ai', needsKey: true },
  { id: 'gemini', label: 'Gemini (BYOK)', recipient: 'generativelanguage.googleapis.com', needsKey: true },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

const base = {
  reasoning: false,
  input: ['text', 'image'] as ('text' | 'image')[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 8_192,
};

export function buildModel(s: Settings): Model<string> {
  const id = modelFor(s, s.provider);
  switch (s.provider) {
    case 'openai':
      return { ...base, id, name: id, api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1' };
    case 'openrouter':
      return { ...base, id, name: id, api: 'openai-completions', provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1' };
    case 'gemini':
      return { ...base, id, name: id, api: 'google-generative-ai', provider: 'google', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' };
    case 'demo':
      return { ...base, id, name: id, api: 'openai-responses', provider: 'demo', baseUrl: `${DEMO_BASE}/demo/v1` };
  }
}

let demoToken: { value: string; expiresAt: number } | null = null;

/** Short-lived demo token; only works from an origin registered on the gateway. */
export async function demoApiKey(): Promise<string> {
  if (demoToken && demoToken.expiresAt - Date.now() > 30_000) return demoToken.value;
  const res = await fetch(`${DEMO_BASE}/demo/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: DEMO_PROJECT }),
  });
  if (!res.ok) throw new Error(`Demo endpoint refused the session (HTTP ${res.status}). It only serves the published site.`);
  const j = (await res.json()) as { token: string; expires_at: string };
  demoToken = { value: j.token, expiresAt: Date.parse(j.expires_at) };
  return j.token;
}

export async function apiKeyFor(s: Settings): Promise<string> {
  if (s.provider === 'demo') return demoApiKey();
  const key = s.keys[s.provider]?.trim();
  if (!key) throw new Error(`Add your ${providerInfo(s.provider).label} key in Settings first.`);
  return key;
}
