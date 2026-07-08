import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeRunStreamStore } from '@crisp/domain/testing';
import type { RunEvent } from '@crisp/domain';
import { createApp } from '../src/app';
import { loadEnv } from '../src/infra/env';
import { ModelRegistry } from '../src/infra/model-registry';
import { AiModelGateway } from '../src/infra/ai-gateway';

const ollamaDown = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;

const makeApp = (envOverrides: Record<string, string | undefined> = {}) => {
  const env = loadEnv({ ...envOverrides });
  const registry = new ModelRegistry(env, ollamaDown);
  const gateway = new AiModelGateway(env, { delayMs: 0 });
  const conversations = new FakeConversationRepository();
  const runStreams = new FakeRunStreamStore();
  const { app, runManager } = createApp({ env, registry, gateway, conversations, runStreams });
  return { app, runManager, conversations, runStreams };
};

const chatBody = (conversationId: string, text: string, overrides: Record<string, unknown> = {}) => ({
  threadId: conversationId,
  runId: 'client-run',
  messages: [{ id: `u-${text.slice(0, 8)}`, role: 'user', parts: [{ type: 'text', content: text }] }],
  forwardedProps: { modelId: 'demo/demo' },
  ...overrides,
});

/** Reads a full SSE response into parsed AG-UI events. */
const readSse = async (response: Response): Promise<RunEvent[]> => {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((payload) => payload.length > 0 && payload !== '[DONE]')
    .map((payload) => JSON.parse(payload) as RunEvent);
};

const waitFor = async (predicate: () => boolean | Promise<boolean>, timeoutMs = 2000) => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('GET /api/models', () => {
  it('lists the demo model as available and gates providers by env', async () => {
    const { app } = makeApp({ ANTHROPIC_API_KEY: 'sk-test' });
    const response = await app.request('/api/models');
    expect(response.status).toBe(200);
    const { models } = (await response.json()) as { models: Array<Record<string, unknown>> };

    const demo = models.find((m) => m.id === 'demo/demo')!;
    expect(demo.available).toBe(true);
    expect(demo.provenance).toBe('local');

    const anthropic = models.filter((m) => m.provider === 'Anthropic');
    expect(anthropic.every((m) => m.available === true)).toBe(true);

    const openai = models.filter((m) => m.provider === 'OpenAI');
    expect(openai.every((m) => m.available === false)).toBe(true);
    expect(openai[0]!.unavailableReason).toContain('OPENAI_API_KEY');

    const ollama = models.filter((m) => m.provider === 'Ollama');
    expect(ollama).toHaveLength(1);
    expect(ollama[0]!.available).toBe(false);
    expect(ollama[0]!.unavailableReason).toContain("isn't running");
  });
});

describe('POST /api/chat', () => {
  it('streams a full AG-UI run and persists the exchange', async () => {
    const { app, conversations } = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-1', 'hello there')),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await readSse(response);

    expect(events[0]!.type).toBe('RUN_STARTED');
    expect(events.some((e) => e.type === 'TEXT_MESSAGE_CONTENT')).toBe(true);
    expect(events.at(-1)!.type).toBe('RUN_FINISHED');

    // run + persistence happen detached from the response stream
    await waitFor(() => (conversations.messages.get('conv-1')?.length ?? 0) === 2);
    const messages = conversations.messages.get('conv-1')!;
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.stats?.ttftMs).toBeGreaterThanOrEqual(0);

    // conversation exists with the fallback (or generated) title
    const list = await app.request('/api/conversations');
    const { conversations: convs } = (await list.json()) as { conversations: Array<{ id: string }> };
    expect(convs.some((c) => c.id === 'conv-1')).toBe(true);
  });

  it('emits a typed RUN_ERROR and persists no assistant message', async () => {
    const { app, conversations } = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-err', 'please error:rate_limited now')),
    });

    const events = await readSse(response);
    const error = events.at(-1)!;
    expect(error.type).toBe('RUN_ERROR');
    expect(error.code).toBe('rate_limited');

    await waitFor(async () => (conversations.messages.get('conv-err')?.length ?? 0) >= 1);
    expect(conversations.messages.get('conv-err')!).toHaveLength(1);
  });

  it('rejects unavailable models', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-x', 'hi', { forwardedProps: { modelId: 'anthropic/claude-sonnet-4-6' } })),
    });
    expect(response.status).toBe(400);
  });

  it('rejects malformed bodies', async () => {
    const { app } = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nope: true }),
    });
    expect(response.status).toBe(400);
  });
});

describe('resume', () => {
  it('replays a live run to a second client after the first disconnects', async () => {
    const { app, conversations, runStreams } = makeApp();

    // First client starts a run and disconnects immediately.
    const firstClient = new AbortController();
    const first = await app.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('conv-resume', 'walk me through markdown')),
        signal: firstClient.signal,
      },
    );
    const runId = first.headers.get('x-run-id')!;
    expect(runId).toBeTruthy();
    firstClient.abort();

    // The conversation reports the live run.
    await waitFor(async () => (await runStreams.activeRun('conv-resume')) !== null || runStreams.finished.size > 0);

    // Second client replays the same run to completion.
    const second = await app.request(`/api/runs/${runId}/events`);
    const events = await readSse(second);
    expect(events[0]!.type).toBe('RUN_STARTED');
    expect(events.at(-1)!.type).toBe('RUN_FINISHED');

    const text = events
      .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
      .map((e) => e.delta)
      .join('');
    expect(text.toLowerCase()).toContain('markdown');

    // And the exchange persisted despite the first client vanishing.
    await waitFor(() => (conversations.messages.get('conv-resume')?.length ?? 0) === 2);
  });

  it('exposes activeRunId on the conversation while live', async () => {
    const { app, runStreams } = makeApp();
    await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-live', 'hi')),
    });
    // after completion the active run clears
    await waitFor(async () => (await runStreams.activeRun('conv-live')) === null);
    const response = await app.request('/api/conversations/conv-live');
    const body = (await response.json()) as { activeRunId: string | null; messages: unknown[] };
    expect(body.activeRunId).toBeNull();
    expect(body.messages).toHaveLength(2);
  });
});

describe('POST /api/runs/:runId/stop', () => {
  it('aborts a live run and keeps the partial message', async () => {
    const env = loadEnv({});
    const registry = new ModelRegistry(env, ollamaDown);
    const gateway = new AiModelGateway(env, { delayMs: 15 });
    const conversations = new FakeConversationRepository();
    const runStreams = new FakeRunStreamStore();
    const { app } = createApp({ env, registry, gateway, conversations, runStreams });

    const client = new AbortController();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-stop', 'long answer please')),
      signal: client.signal,
    });
    const runId = response.headers.get('x-run-id')!;

    // let a few tokens arrive, then stop
    await waitFor(() => {
      const events = runStreams.events.get(runId) ?? [];
      return events.filter((e) => e.type === 'TEXT_MESSAGE_CONTENT').length >= 3;
    });
    const stop = await app.request(`/api/runs/${runId}/stop`, { method: 'POST' });
    expect(stop.status).toBe(200);
    client.abort();

    await waitFor(() => (conversations.messages.get('conv-stop')?.length ?? 0) === 2);
    const assistant = conversations.messages.get('conv-stop')![1]!;
    expect(assistant.stoppedEarly).toBe(true);
    expect(assistant.parts[0]!.content.length).toBeGreaterThan(0);

    const again = await app.request(`/api/runs/${runId}/stop`, { method: 'POST' });
    expect(again.status).toBe(404);
  });
});
