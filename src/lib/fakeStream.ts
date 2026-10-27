import { createAssistantMessageEventStream, type AssistantMessage } from '@mariozechner/pi-ai';
import type { StreamFn } from '@mariozechner/pi-agent-core';
import { imageLimits } from './providers';

/** Deterministic provider for tests: text replies or actual harness tool calls. */
export function fakeStream(replies: (string | { name: string; arguments: Record<string, unknown> }[])[]): StreamFn {
  let i = 0;
  return (model, context) => {
    const count = (JSON.stringify(context.messages).match(/"type":"image"/g) ?? []).length;
    if (count > imageLimits(model.provider === 'demo' ? 'demo' : 'openai').requestImages) throw new Error(`Fake provider received ${count} images, exceeding the request budget`);
    const reply = replies[Math.min(i++, replies.length - 1)];
    const calls = typeof reply !== 'string';
    const message: AssistantMessage = {
      role: 'assistant',
      content: typeof reply === 'string' ? [{ type: 'text', text: reply }] : reply.map((call, index) => ({ type: 'toolCall', id: `call_${i}_${index}`, ...call })),
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: calls ? 'toolUse' : 'stop',
      timestamp: Date.now(),
    };
    const s = createAssistantMessageEventStream();
    queueMicrotask(() => {
      s.push({ type: 'start', partial: message });
      s.push({ type: 'done', reason: calls ? 'toolUse' : 'stop', message });
      s.end();
    });
    return s;
  };
}
