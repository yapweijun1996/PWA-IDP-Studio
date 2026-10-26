import { describe, expect, it } from 'vitest';
import { sanitizePayload } from './providers';

const forbidden = ['max_output_tokens', 'max_tokens', 'previous_response_id', 'temperature', 'top_p', 'prompt_cache_key', 'include', 'reasoning', 'service_tier', 'metadata'];

describe('sanitizePayload', () => {
  it('allowlists demo controls, preserves image parts, and never mutates the payload', () => {
    const input = [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA', detail: 'auto' }] }];
    const tools = [{ type: 'function', name: 'crop_zoom', parameters: { type: 'object' } }];
    const payload = Object.freeze({ model: 'demo-auto', input, tools, tool_choice: 'auto', parallel_tool_calls: false, stream: true, store: true, instructions: 'Extract JSON', ...Object.fromEntries(forbidden.map(key => [key, 8192])), future_control: true });
    const result = sanitizePayload('demo', payload);
    expect(result).toEqual({ model: 'demo-auto', input, tools, tool_choice: 'auto', parallel_tool_calls: false, stream: true, store: false, instructions: 'Extract JSON' });
    expect(result).not.toBe(payload);
    expect(result && typeof result === 'object' && 'input' in result && result.input).toBe(input);
    expect(payload.store).toBe(true);
    for (const key of forbidden) expect(payload[key as keyof typeof payload]).toBe(8192);
  });

  it.each(['openai', 'openrouter', 'gemini'] as const)('returns %s payloads unchanged', provider => {
    const payload = Object.freeze({ model: 'byok', tools: [{ name: 'submit_result' }], tool_choice: 'auto', parallel_tool_calls: false, max_output_tokens: 8192, store: true });
    expect(sanitizePayload(provider, payload)).toBe(payload);
  });
});

describe('diagnoseConnection', () => {
  it('stops at the first failing step and reports the error name', async () => {
    const { diagnoseConnection } = await import('./providers');
    const { loadSettings } = await import('./settings');
    const failing = (async () => { throw new TypeError('Load failed'); }) as unknown as typeof fetch;
    const steps = await diagnoseConnection({ ...loadSettings(), provider: 'demo' }, failing);
    expect(steps.map(s => s.ok)).toEqual([true, false]);
    expect(steps[1].detail).toContain('TypeError: Load failed');
  });
});
