import { describe, expect, it } from 'vitest';
import { sanitizePayload } from './providers';

const forbidden = ['max_output_tokens', 'max_tokens', 'previous_response_id', 'temperature', 'top_p', 'prompt_cache_key', 'include', 'reasoning', 'service_tier', 'metadata'];

describe('sanitizePayload', () => {
  it('allowlists demo controls, preserves image parts, and never mutates the payload', () => {
    const input = [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' }] }];
    const payload = Object.freeze({ model: 'demo-auto', input, stream: true, store: true, instructions: 'Extract JSON', ...Object.fromEntries(forbidden.map(key => [key, 8192])), future_control: true });
    const result = sanitizePayload('demo', payload);
    expect(result).toEqual({ model: 'demo-auto', input, stream: true, store: false, instructions: 'Extract JSON' });
    expect(result).not.toBe(payload);
    expect(result && typeof result === 'object' && 'input' in result && result.input).toBe(input);
    expect(payload.store).toBe(true);
    for (const key of forbidden) expect(payload[key as keyof typeof payload]).toBe(8192);
  });

  it.each(['openai', 'openrouter', 'gemini'] as const)('returns %s payloads unchanged', provider => {
    const payload = Object.freeze({ model: 'byok', max_output_tokens: 8192, store: true });
    expect(sanitizePayload(provider, payload)).toBe(payload);
  });
});
