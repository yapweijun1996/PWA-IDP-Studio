import { describe, expect, it } from 'vitest';
import { imageLimits, sanitizePayload } from './providers';

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

describe('demo payload reasoning items', () => {
  it('drops replayed reasoning items (gateway rejects them without encrypted_content) but keeps tool items', () => {
    const out = sanitizePayload('demo', { model: 'm', input: [{ role: 'user', content: 'x' }, { type: 'reasoning', id: 'rs_1', content: [], summary: [] }, { type: 'function_call', call_id: 'c', name: 'n', arguments: '{}' }, { type: 'function_call_output', call_id: 'c', output: 'ok' }], tools: [] }) as { input: { type?: string }[] };
    expect(out.input.map(i => i.type ?? 'user')).toEqual(['user', 'function_call', 'function_call_output']);
  });
  it('leaves BYOK payloads untouched', () => {
    const payload = { input: [{ type: 'reasoning', id: 'rs_1' }] };
    expect(sanitizePayload('openai', payload)).toBe(payload);
  });
});

it.each(['demo', 'openai', 'openrouter', 'gemini'] as const)('defines image batching for %s', provider => {
  const limits = imageLimits(provider);
  expect(limits).toEqual(provider === 'demo'
    ? { requestImages: 4, window: 4, extractPages: 2, toolImages: 2, singlePassPages: 2 }
    : { requestImages: Infinity, window: 10, extractPages: 10, toolImages: 12, singlePassPages: 10 });
  expect(limits.extractPages + limits.toolImages).toBeLessThanOrEqual(limits.requestImages);
});
