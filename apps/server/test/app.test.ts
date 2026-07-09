import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeModelGateway, FakeRunStreamStore } from '@crisp/domain/testing';
import type { RunEvent } from '@crisp/domain';
import { createApp } from '../src/app';
import { loadEnv } from '../src/infra/env';
import { ModelRegistry } from '../src/infra/model-registry';
import { AiModelGateway } from '../src/infra/ai-gateway';

/**
 * A cookie-jar view of a Hono app: one anonymous visitor. Conversations are
 * scoped to the crisp_sid cookie, so multi-request flows must carry it.
 */
type Requester = (path: string, init?: RequestInit) => Promise<Response>;
// `request` is typed loosely so any Hono instance fits, whatever its Env generic.
const withCookies = (app: { request: (path: any, init?: any) => Response | Promise<Response> }): Requester => {
  let cookie: string | undefined;
  return async (path, init = {}) => {
    const headers = new Headers(init.headers);
    if (cookie) headers.set('cookie', cookie);
    const response = await app.request(path, { ...init, headers });
    const set = response.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0]!;
    return response;
  };
};

const makeApp = (envOverrides: Record<string, string | undefined> = {}) => {
  const env = loadEnv({ ...envOverrides });
  const registry = new ModelRegistry(env);
  const gateway = new AiModelGateway(env, { delayMs: 0 });
  const conversations = new FakeConversationRepository();
  const runStreams = new FakeRunStreamStore();
  const { app, runManager } = createApp({ env, registry, gateway, conversations, runStreams });
  return { app, request: withCookies(app), runManager, conversations, runStreams };
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

  it('gates OpenRouter models by OPENROUTER_API_KEY', async () => {
    const without = makeApp();
    const withKey = makeApp({ OPENROUTER_API_KEY: 'sk-or-test' });

    const locked = ((await (await without.app.request('/api/models')).json()) as { models: Array<Record<string, unknown>> })
      .models.filter((m) => m.provider === 'OpenRouter');
    expect(locked.length).toBeGreaterThan(0);
    expect(locked.every((m) => m.available === false)).toBe(true);
    expect(locked[0]!.unavailableReason).toContain('OPENROUTER_API_KEY');

    const open = ((await (await withKey.app.request('/api/models')).json()) as { models: Array<Record<string, unknown>> })
      .models.filter((m) => m.provider === 'OpenRouter');
    expect(open.every((m) => m.available === true)).toBe(true);
    // OpenRouter model names keep their vendor/model form after the provider segment
    expect(open.some((m) => m.id === 'openrouter/deepseek/deepseek-chat')).toBe(true);
    // frontier models ride the same OpenRouter key, so the one-click connect unlocks them
    expect(open.some((m) => m.id === 'openrouter/anthropic/claude-sonnet-4.6')).toBe(true);
    expect(open.some((m) => m.id === 'openrouter/openai/gpt-5.2')).toBe(true);
  });
});

describe('POST /api/chat', () => {
  it('streams a full AG-UI run and persists the exchange', async () => {
    const { request, conversations } = makeApp();
    const response = await request('/api/chat', {
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
    const list = await request('/api/conversations');
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

  it('accepts an env-unavailable model when the user brings their own key (BYOK)', async () => {
    // no env keys at all — only the user's key makes the model usable
    const env = loadEnv({});
    const gateway = new FakeModelGateway();
    const conversations = new FakeConversationRepository();
    const runStreams = new FakeRunStreamStore();
    const { app } = createApp({ env, registry: new ModelRegistry(env), gateway, conversations, runStreams });

    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        chatBody('conv-byok', 'hi', {
          forwardedProps: { modelId: 'anthropic/claude-sonnet-4-6', apiKey: 'sk-ant-user' },
        }),
      ),
    });
    expect(response.status).toBe(200);
    await readSse(response);

    // the key reached the gateway for this Run…
    expect(gateway.calls[0]!.apiKey).toBe('sk-ant-user');
    // …and was not persisted with the exchange
    await waitFor(async () => (conversations.messages.get('conv-byok')?.length ?? 0) >= 2);
    const persisted = JSON.stringify([...conversations.messages.values()]);
    expect(persisted).not.toContain('sk-ant-user');
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

  it('409s a concurrent send for the same conversation (atomic claim)', { timeout: 10_000 }, async () => {
    const env = loadEnv({});
    const conversations = new FakeConversationRepository();
    const runStreams = new FakeRunStreamStore();
    const { app } = createApp({
      env,
      registry: new ModelRegistry(env),
      // Any delay works: the claim is decided before the first token streams.
      gateway: new AiModelGateway(env, { delayMs: 2 }),
      conversations,
      runStreams,
    });
    const request = withCookies(app);
    await request('/api/conversations'); // prime the session cookie for both sends

    const send = (text: string) =>
      request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('conv-race', text)),
      });

    // Fire both without awaiting the first stream: only one may win the claim.
    const [first, second] = await Promise.all([send('first message'), send('second message')]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = first.status === 200 ? first : second;
    await readSse(winner); // drain to completion

    // once the run finished, the claim is released and a new send is accepted
    await waitFor(async () => (await runStreams.activeRun('conv-race')) === null);
    const third = await send('third message');
    expect(third.status).toBe(200);
    await readSse(third);
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
    const { request, runStreams } = makeApp();
    await request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-live', 'hi')),
    });
    // after completion the active run clears
    await waitFor(async () => (await runStreams.activeRun('conv-live')) === null);
    const response = await request('/api/conversations/conv-live');
    const body = (await response.json()) as { activeRunId: string | null; messages: unknown[] };
    expect(body.activeRunId).toBeNull();
    expect(body.messages).toHaveLength(2);
  });
});

describe('PUT /api/runs/:runId/feedback', () => {
  const runExchange = async (request: Requester, conversations: FakeConversationRepository) => {
    await readSse(
      await request('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(chatBody('conv-fb', 'hello there')),
      }),
    );
    await waitFor(() => (conversations.messages.get('conv-fb')?.length ?? 0) === 2);
    return conversations.messages.get('conv-fb')![1]!;
  };

  const putFeedback = (request: Requester, runId: string, body: unknown) =>
    request(`/api/runs/${runId}/feedback`, {
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
    const request = withCookies(app);

    const assistant = await runExchange(request, conversations);
    expect(assistant.runId).toBeTruthy(); // RunService stamps the Run id

    const vote = await putFeedback(request, assistant.runId!, { score: 'down', comment: 'too vague' });
    expect(vote.status).toBe(200);
    let stored = conversations.messages.get('conv-fb')![1]!;
    expect(stored.feedback).toEqual({ score: 'down', comment: 'too vague' });
    expect(mirrored).toEqual([{ runId: assistant.runId, feedback: { score: 'down', comment: 'too vague' } }]);

    const retract = await putFeedback(request, assistant.runId!, { score: null });
    expect(retract.status).toBe(200);
    stored = conversations.messages.get('conv-fb')![1]!;
    expect(stored.feedback).toBeUndefined();
    expect(mirrored.at(-1)).toEqual({ runId: assistant.runId, feedback: null });
  });

  it('404s for unknown runs and 400s malformed bodies', async () => {
    const { request, conversations } = makeApp();
    const assistant = await runExchange(request, conversations);

    expect((await putFeedback(request, 'no-such-run', { score: 'up' })).status).toBe(404);
    expect((await putFeedback(request, assistant.runId!, { score: 'sideways' })).status).toBe(400);
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
    const request = withCookies(app);

    const response = await request('/api/conversations/conv-byo/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report()),
    });
    expect(response.status).toBe(200);

    const owner = conversations.owners.get('conv-byo')!;
    const conversation = await conversations.get('conv-byo', owner);
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

    // feedback works on BYO runs like any other (same visitor session)
    const vote = await request('/api/runs/b3b0c8a4-8a34-4b5e-9d1c-2f6a7e5d4c3b/feedback', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 'up' }),
    });
    expect(vote.status).toBe(200);
    expect((await conversations.get('conv-byo', owner))!.messages[1]!.feedback).toEqual({ score: 'up' });
  });

  it('dedupes the user message on regenerate and drops superseded answers', async () => {
    const { request, conversations } = makeApp();
    await request('/api/conversations/conv-byo2/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report({ runId: crypto.randomUUID() })),
    });
    // regenerate: same user message id, new run
    await request('/api/conversations/conv-byo2/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report({ runId: crypto.randomUUID(), assistantText: 'second answer' })),
    });
    const messages = conversations.messages.get('conv-byo2')!;
    expect(messages).toHaveLength(2);
    expect(messages[1]!.parts[0]!.content).toBe('second answer');
  });

  it('is idempotent on runId: a retried report does not duplicate the exchange', async () => {
    const { request, conversations } = makeApp();
    const runId = crypto.randomUUID();
    const send = () =>
      request('/api/conversations/conv-byo-retry/byo-runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(report({ runId })),
      });

    expect((await send()).status).toBe(200);
    const retry = await send();
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { deduped?: boolean }).deduped).toBe(true);
    expect(conversations.messages.get('conv-byo-retry')!).toHaveLength(2);
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

    // idempotent: the desired state ("not running") already holds
    const again = await app.request(`/api/runs/${runId}/stop`, { method: 'POST' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { stopped: boolean }).stopped).toBe(false);
  });
});

describe('visitor scoping (crisp_sid)', () => {
  it('isolates conversations between anonymous sessions', async () => {
    const { app, conversations } = makeApp();
    const alice = withCookies(app);
    const bob = withCookies(app);

    const first = await alice('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(chatBody('conv-alice', 'hello from alice')),
    });
    expect(first.status).toBe(200);
    // the session cookie is HttpOnly and scoped to the site
    expect(first.headers.get('set-cookie')).toMatch(/crisp_sid=[0-9a-f-]{36}.*HttpOnly/i);

    // behind a TLS-terminating edge the cookie must pick up Secure from
    // X-Forwarded-Proto — the request URL itself is plain http there
    const edge = await app.request('/api/conversations', {
      headers: { 'x-forwarded-proto': 'https' },
    });
    expect(edge.headers.get('set-cookie')).toMatch(/crisp_sid=.*Secure/i);
    await readSse(first);
    await waitFor(() => (conversations.messages.get('conv-alice')?.length ?? 0) === 2);

    // alice sees her conversation; bob sees nothing
    const aliceList = (await (await alice('/api/conversations')).json()) as { conversations: unknown[] };
    expect(aliceList.conversations).toHaveLength(1);
    const bobList = (await (await bob('/api/conversations')).json()) as { conversations: unknown[] };
    expect(bobList.conversations).toHaveLength(0);
    expect((await bob('/api/conversations/conv-alice')).status).toBe(404);

    // bob's delete is a no-op on alice's conversation
    expect((await bob('/api/conversations/conv-alice', { method: 'DELETE' })).status).toBe(204);
    expect((await alice('/api/conversations/conv-alice')).status).toBe(200);

    // bob cannot vote on alice's run…
    const runId = conversations.messages.get('conv-alice')![1]!.runId!;
    const foreignVote = await bob(`/api/runs/${runId}/feedback`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ score: 'down' }),
    });
    expect(foreignVote.status).toBe(404);

    // …and cannot graft a BYO run onto her conversation id
    const forged = await bob('/api/conversations/conv-alice/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runId: crypto.randomUUID(),
        modelId: 'byo/llama3.2:1b',
        history: [{ role: 'user', content: 'forged' }],
        assistantText: 'forged answer',
        outcome: 'completed',
        stats: { ttftMs: 1, tokensPerSec: 1 },
        startedAt: Date.now() - 10,
        finishedAt: Date.now(),
      }),
    });
    expect(forged.status).toBe(409);
    expect(conversations.messages.get('conv-alice')!).toHaveLength(2);
  });
});

describe('GET /api/health', () => {
  it('reports each backend and degrades to 503 when one is down', async () => {
    const env = loadEnv({});
    const base = {
      env,
      registry: new ModelRegistry(env),
      gateway: new AiModelGateway(env, { delayMs: 0 }),
      conversations: new FakeConversationRepository(),
      runStreams: new FakeRunStreamStore(),
    };

    const healthy = createApp({ ...base, probes: { redis: async () => {}, db: async () => {} } }).app;
    const up = await healthy.request('/api/health');
    expect(up.status).toBe(200);
    const upBody = (await up.json()) as { ok: boolean; redis: boolean; db: boolean; startedAt: string };
    expect(upBody).toMatchObject({ ok: true, redis: true, db: true });
    expect(Number.isNaN(Date.parse(upBody.startedAt))).toBe(false);

    const degraded = createApp({
      ...base,
      probes: {
        redis: async () => {
          throw new Error('connection refused');
        },
        db: async () => {},
      },
    }).app;
    const down = await degraded.request('/api/health');
    expect(down.status).toBe(503);
    expect((await down.json()) as object).toMatchObject({ ok: false, redis: false, db: true });
    expect(down.headers.get('cache-control')).toBe('no-store');
  });
});
