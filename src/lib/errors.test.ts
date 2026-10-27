import { describe, expect, it } from 'vitest';
import { friendlyProviderError } from './errors';

describe('friendlyProviderError', () => {
  it.each(['Connection error.', 'Load failed', 'Failed to fetch', 'NetworkError when attempting to fetch resource.'])('explains network failure %s', raw => {
    const message = friendlyProviderError(raw, 'demo');
    expect(message).toContain('Could not reach the AI service');
    expect(message).toContain('gpt.yapweijun1996.com');
    expect(message).toContain('Your file is saved');
    expect(message).toContain(raw.trim());
  });
  it('passes provider API errors through untouched', () => {
    expect(friendlyProviderError('429 rate limit', 'openai')).toBe('429 rate limit');
  });
  it('explains the demo image cap as an app batching bug', () => {
    expect(friendlyProviderError('400 DEMO_IMAGE_COUNT_EXCEEDED', 'demo')).toBe("The demo service accepts at most 4 page images per request. This is a bug in the app's page batching; please report it.");
  });
});
