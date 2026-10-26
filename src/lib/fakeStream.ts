import { createAssistantMessageEventStream, type AssistantMessage } from '@mariozechner/pi-ai';
import type { StreamFn } from '@mariozechner/pi-agent-core';

/** Deterministic provider for tests and offline demos: replies with the given texts in order. */
export function fakeStream(replies: string[]): StreamFn {
  let i = 0;
  return (model) => {
    const text = replies[Math.min(i++, replies.length - 1)];
    const message: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'text', text }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop',
      timestamp: Date.now(),
    };
    const s = createAssistantMessageEventStream();
    queueMicrotask(() => {
      s.push({ type: 'start', partial: message });
      s.push({ type: 'done', reason: 'stop', message });
      s.end();
    });
    return s;
  };
}
