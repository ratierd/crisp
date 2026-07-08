import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeRunStreamStore } from '@crisp/domain/testing';
import { createApp } from '../src/app';
import { loadEnv } from '../src/infra/env';
import { ModelRegistry } from '../src/infra/model-registry';
import { AiModelGateway } from '../src/infra/ai-gateway';

const waitFor = async (predicate: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('regenerate', () => {
  it('replaces the previous assistant message instead of appending a second one', async () => {
    const env = loadEnv({});
    const registry = new ModelRegistry(env);
    const gateway = new AiModelGateway(env, { delayMs: 0 });
    const conversations = new FakeConversationRepository();
    const runStreams = new FakeRunStreamStore();
    const { app } = createApp({ env, registry, gateway, conversations, runStreams });

    const body = {
      threadId: 'conv-regen',
      messages: [{ id: 'u-1', role: 'user', parts: [{ type: 'text', content: 'hello' }] }],
      forwardedProps: { modelId: 'demo/demo' },
    };
    const first = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await first.text();
    await waitFor(() => (conversations.messages.get('conv-regen')?.length ?? 0) === 2);
    const firstAssistantId = conversations.messages.get('conv-regen')![1]!.id;

    // reload() resends history ending at the same user message
    const second = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await second.text();
    await waitFor(() => {
      const messages = conversations.messages.get('conv-regen') ?? [];
      return messages.length === 2 && messages[1]!.id !== firstAssistantId;
    });

    const messages = conversations.messages.get('conv-regen')!;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.id).toBe('u-1');
    expect(messages[1]!.role).toBe('assistant');
  });
});
