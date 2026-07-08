import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeRunStreamStore } from '@crisp/domain/testing';
import type { RunEvent } from '@crisp/domain';
import { createApp } from '../src/app';
import { loadEnv } from '../src/infra/env';
import { ModelRegistry } from '../src/infra/model-registry';
import { AiModelGateway } from '../src/infra/ai-gateway';

const makeApp = (envOverrides: Record<string, string | undefined> = {}) => {
  const env = loadEnv({ ...envOverrides });
  const registry = new ModelRegistry(env);
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

    // local models are BYO-only (ADR-0004) — the server never lists Ollama
    expect(models.some((m) => String(m.id).startsWith('ollama/'))).toBe(false);
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

describe('PUT /api/runs/:runId/feedback', () => {
  const runExchange = async (app: ReturnType<typeof makeApp>['app'], conversations: FakeConversationRepository) => {
    await readSse(
      await app.request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('conv-fb', 'hello there')),
      }),
    );
    await waitFor(() => (conversations.messages.get('conv-fb')?.length ?? 0) === 2);
    return conversations.messages.get('conv-fb')![1]!;
  };

  const putFeedback = (app: ReturnType<typeof makeApp>['app'], runId: string, body: unknown) =>
    app.request(`/api/runs/${runId}/feedback`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('persists a vote on the message, mirrors it, and retracts on null', async () => {
    const mirrored: Array<{ runId: string; feedback: unknown }> = [];
    const env = loadEnv({});
    const conversations = new FakeConversationRepository();
    const { app } = createApp({
      env,
      registry: new ModelRegistry(env),
      gateway: new AiModelGateway(env, { delayMs: 0 }),
      conversations,
      runStreams: new FakeRunStreamStore(),
      feedback: { record: async (runId, feedback) => void mirrored.push({ runId, feedback }) },
    });

    const assistant = await runExchange(app, conversations);
    expect(assistant.runId).toBeTruthy(); // RunService stamps the Run id

    const vote = await putFeedback(app, assistant.runId!, { score: 'down', comment: 'too vague' });
    expect(vote.status).toBe(200);
    let stored = conversations.messages.get('conv-fb')![1]!;
    expect(stored.feedback).toEqual({ score: 'down', comment: 'too vague' });
    expect(mirrored).toEqual([{ runId: assistant.runId, feedback: { score: 'down', comment: 'too vague' } }]);

    const retract = await putFeedback(app, assistant.runId!, { score: null });
    expect(retract.status).toBe(200);
    stored = conversations.messages.get('conv-fb')![1]!;
    expect(stored.feedback).toBeUndefined();
    expect(mirrored.at(-1)).toEqual({ runId: assistant.runId, feedback: null });
  });

  it('404s for unknown runs and 400s malformed bodies', async () => {
    const { app, conversations } = makeApp();
    const assistant = await runExchange(app, conversations);

    expect((await putFeedback(app, 'no-such-run', { score: 'up' })).status).toBe(404);
    expect((await putFeedback(app, assistant.runId!, { score: 'sideways' })).status).toBe(400);
  });
});

describe('POST /api/conversations/:id/byo-runs', () => {
  const report = (overrides: Record<string, unknown> = {}) => ({
    runId: 'b3b0c8a4-8a34-4b5e-9d1c-2f6a7e5d4c3b',
    modelId: 'byo/llama3.2:1b',
    history: [{ role: 'user', content: 'hi from the browser' }],
    userMessage: {
      id: 'u-byo-1',
      role: 'user',
      parts: [{ type: 'text', content: 'hi from the browser' }],
      createdAt: new Date().toISOString(),
    },
    assistantText: 'hello from your own machine',
    outcome: 'completed',
    stats: { ttftMs: 120, tokensPerSec: 9 },
    usage: { promptTokens: 6, completionTokens: 7, totalTokens: 13 },
    startedAt: Date.now() - 2000,
    finishedAt: Date.now(),
    ...overrides,
  });

  it('creates the conversation, persists the exchange, and mirrors the run', async () => {
    const mirrored: unknown[] = [];
    const env = loadEnv({});
    const conversations = new FakeConversationRepository();
    const { app } = createApp({
      env,
      registry: new ModelRegistry(env),
      gateway: new AiModelGateway(env, { delayMs: 0 }),
      conversations,
      runStreams: new FakeRunStreamStore(),
      runMirror: { record: async (run) => void mirrored.push(run) },
    });

    const response = await app.request('/api/conversations/conv-byo/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report()),
    });
    expect(response.status).toBe(200);

    const conversation = await conversations.get('conv-byo');
    expect(conversation).not.toBeNull();
    expect(conversation!.title.length).toBeGreaterThan(0);
    const [user, assistant] = conversation!.messages;
    expect(user!.role).toBe('user');
    expect(assistant!.role).toBe('assistant');
    expect(assistant!.runId).toBe('b3b0c8a4-8a34-4b5e-9d1c-2f6a7e5d4c3b');
    expect(assistant!.modelId).toBe('byo/llama3.2:1b');
    expect(assistant!.parts[0]!.content).toBe('hello from your own machine');

    await waitFor(() => mirrored.length === 1);
    const run = mirrored[0] as { model: { provenance: string }; usage?: unknown; outcome: string };
    expect(run.model.provenance).toBe('local');
    expect(run.outcome).toBe('completed');
    expect(run.usage).toEqual({ promptTokens: 6, completionTokens: 7, totalTokens: 13 });

    // feedback works on BYO runs like any other
    const vote = await app.request('/api/runs/b3b0c8a4-8a34-4b5e-9d1c-2f6a7e5d4c3b/feedback', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 'up' }),
    });
    expect(vote.status).toBe(200);
    expect((await conversations.get('conv-byo'))!.messages[1]!.feedback).toEqual({ score: 'up' });
  });

  it('dedupes the user message on regenerate and drops superseded answers', async () => {
    const { app, conversations } = makeApp();
    await app.request('/api/conversations/conv-byo2/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report({ runId: crypto.randomUUID() })),
    });
    // regenerate: same user message id, new run
    await app.request('/api/conversations/conv-byo2/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report({ runId: crypto.randomUUID(), assistantText: 'second answer' })),
    });
    const messages = conversations.messages.get('conv-byo2')!;
    expect(messages).toHaveLength(2);
    expect(messages[1]!.parts[0]!.content).toBe('second answer');
  });

  it('persists nothing but still accepts a failed run report', async () => {
    const { app, conversations } = makeApp();
    const response = await app.request('/api/conversations/conv-byo3/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        report({ runId: crypto.randomUUID(), assistantText: '', outcome: 'failed', error: 'CORS blocked', userMessage: undefined }),
      ),
    });
    expect(response.status).toBe(200);
    expect(conversations.messages.get('conv-byo3') ?? []).toHaveLength(0);
  });
});

describe('POST /api/runs/:runId/stop', () => {
  it('aborts a live run and keeps the partial message', async () => {
    const env = loadEnv({});
    const registry = new ModelRegistry(env);
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
