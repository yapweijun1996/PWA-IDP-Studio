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

/** The demo gateway accepts only these Responses controls; BYOK payloads pass through. */
export function sanitizePayload(provider: ProviderId, payload: unknown): unknown {
  if (provider !== 'demo') return payload;
  const source = (payload ?? {}) as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const key of ['model', 'input', 'stream', 'instructions']) {
    if (Object.prototype.hasOwnProperty.call(source, key)) sanitized[key] = source[key];
  }
  return { ...sanitized, store: false };
}

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

export interface DiagnosticStep { label: string; ok: boolean; detail: string }

const describe = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

/** Step-by-step reachability check so a failing device can show where the request stops. */
export async function diagnoseConnection(s: Settings, fetchFn: typeof fetch = fetch.bind(globalThis)): Promise<DiagnosticStep[]> {
  const steps: DiagnosticStep[] = [];
  const run = async (label: string, fn: () => Promise<string>) => {
    const started = Date.now();
    try { steps.push({ label, ok: true, detail: `${await fn()} (${Date.now() - started} ms)` }); return true; }
    catch (e) { steps.push({ label, ok: false, detail: `${describe(e)} (${Date.now() - started} ms)` }); return false; }
  };
  steps.push({ label: 'Browser', ok: navigator.onLine !== false, detail: `${navigator.onLine === false ? 'offline' : 'online'} · ${navigator.userAgent}` });
  const recipientHost = { demo: DEMO_BASE, openai: 'https://api.openai.com', openrouter: 'https://openrouter.ai', gemini: 'https://generativelanguage.googleapis.com' }[s.provider];
  if (!await run(`Reach ${new URL(recipientHost).host}`, async () => { await fetchFn(recipientHost, { mode: 'no-cors' }); return 'reachable'; })) return steps;
  if (s.provider !== 'demo') return steps;
  let token = '';
  if (!await run('Demo session', async () => { demoToken = null; token = await demoApiKey(); return 'token issued'; })) return steps;
  await run('Demo streaming request', async () => {
    const res = await fetchFn(`${DEMO_BASE}/demo/v1/responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: modelFor(s, 'demo'), input: 'Reply with OK.', stream: true, store: false }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) return `HTTP ${res.status}, no stream support`;
    const first = await reader.read();
    await reader.cancel();
    return `HTTP ${res.status}, stream ${first.done ? 'empty' : 'received'}`;
  });
  return steps;
}
