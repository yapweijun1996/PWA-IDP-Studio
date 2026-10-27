import { imageLimits } from './providers';
import type { ProviderId } from './types';

export const AGENT_CONFIG_KEY = 'idp-studio.agent-config.v1';
export const BOUNDARY_MIN_CONFIDENCE = 0.7;
export const OPTIONAL_TOOLS = ['read_text_layer', 'crop_zoom', 'scan_codes'] as const;
export interface AgentConfig {
  maxTurns: number;
  timeoutSeconds: number;
  toolImages: number;
  boundaryConfidence: number;
  tools: Record<typeof OPTIONAL_TOOLS[number], boolean>;
}
export const DEFAULT_AGENT_CONFIG: AgentConfig = { maxTurns: 8, timeoutSeconds: 120, toolImages: imageLimits('openai').toolImages, boundaryConfidence: BOUNDARY_MIN_CONFIDENCE, tools: { read_text_layer: true, crop_zoom: true, scan_codes: true } };
const clamp = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, integer ? Math.trunc(n) : n));
};
export function clampAgentConfig(value: unknown, provider: ProviderId): AgentConfig {
  const v = value && typeof value === 'object' ? value as Partial<AgentConfig> : {};
  return {
    maxTurns: clamp(v.maxTurns, 8, 1, 16, true),
    timeoutSeconds: clamp(v.timeoutSeconds, 120, 30, 300, true),
    toolImages: clamp(v.toolImages, imageLimits(provider).toolImages, 1, imageLimits(provider).toolImages, true),
    boundaryConfidence: clamp(v.boundaryConfidence, DEFAULT_AGENT_CONFIG.boundaryConfidence, 0.5, 0.95),
    tools: Object.fromEntries(OPTIONAL_TOOLS.map(name => [name, typeof v.tools?.[name] === 'boolean' ? v.tools[name] : true])) as AgentConfig['tools'],
  };
}

export function isValidAgentConfig(value: unknown, provider: ProviderId): value is AgentConfig {
  if (!value || typeof value !== 'object') return false;
  const v = value as AgentConfig;
  const clamped = clampAgentConfig(v, provider);
  return v.maxTurns === clamped.maxTurns && v.timeoutSeconds === clamped.timeoutSeconds
    && v.toolImages === clamped.toolImages && v.boundaryConfidence === clamped.boundaryConfidence
    && OPTIONAL_TOOLS.every(name => typeof v.tools?.[name] === 'boolean');
}
export function loadAgentConfig(provider: ProviderId): AgentConfig {
  try { return clampAgentConfig(JSON.parse(localStorage.getItem(AGENT_CONFIG_KEY) ?? 'null'), provider); }
  catch { return clampAgentConfig(null, provider); }
}
export function saveAgentConfig(value: AgentConfig, provider: ProviderId): AgentConfig {
  const config = clampAgentConfig(value, provider);
  localStorage.setItem(AGENT_CONFIG_KEY, JSON.stringify(config));
  return config;
}
