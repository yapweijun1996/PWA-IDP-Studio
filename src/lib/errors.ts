import { providerInfo } from './providers';
import type { ProviderId } from './types';

const NETWORK = /connection error|load failed|failed to fetch|networkerror|network request failed|fetch failed/i;

/** Turns opaque SDK/browser network errors into an actionable message; other errors pass through. */
export function friendlyProviderError(raw: string, provider: ProviderId): string {
  if (raw.includes('DEMO_IMAGE_COUNT_EXCEEDED')) return "The demo service accepts at most 4 page images per request. This is a bug in the app's page batching; please report it.";
  if (!NETWORK.test(raw)) return raw;
  const target = providerInfo(provider).recipient;
  return `Could not reach the AI service (${target}). Check your connection, VPN, Private Relay or content blockers, then retry. Your file is saved on this device. (${raw.trim()})`;
}
