import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeRunStreamStore } from '@crisp/domain/testing';
import type { RunStreamStore } from '@crisp/domain';
import { createApp } from '../src/app';
import { loadEnv } from '../src/infra/env';
import { ModelRegistry } from '../src/infra/model-registry';
import { AiModelGateway } from '../src/infra/ai-gateway';

/**
 * Edge cases around the visitor-scoping and claim machinery that the main
 * suites don't reach: the chat route against a foreign conversation id, the
 * claim store dying, malformed BYO reports, and the run-id capability
 * contract (replay/stop are addressed by server-minted UUIDs; feedback is
 * additionally owner-scoped).
 */
type Requester = (path: string, init?: RequestInit) => Promise<Response>;
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

const makeApp = (runStreams: RunStreamStore = new FakeRunStreamStore()) => {
  const env = loadEnv({});
  const conversations = new FakeConversationRepository();
  const { app } = createApp({
    env,
    registry: new ModelRegistry(env),
    gateway: new AiModelGateway(env, { delayMs: 0 }),
    conversations,
    runStreams,
  });
  return { app, conversations, runStreams };
};

const chatBody = (conversationId: string, text: string) => ({
  threadId: conversationId,
  runId: 'client-chosen-run-id',
  messages: [{ id: `u-${text.slice(0, 8)}`, role: 'user', parts: [{ type: 'text', content: text }] }],
  forwardedProps: { modelId: 'demo/demo' },
});

const post = (request: Requester, path: string, body: unknown) =>
  request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /api/chat against a foreign conversation id', () => {
  it('409s without leaking or mutating, and releases the claim so the owner is unaffected', async () => {
    const { app, runStreams } = makeApp();
    const alice = withCookies(app);
    const mallory = withCookies(app);

    const first = await post(alice, '/api/chat', chatBody('conv-target', 'hello from alice'));
    expect(first.status).toBe(200);
    await first.text(); // drain to completion

    // Mallory tries to graft a run onto Alice's conversation id.
    const grab = await post(mallory, '/api/chat', chatBody('conv-target', 'hostile takeover'));
    expect(grab.status).toBe(409);

    // The failed attempt must not leave the conversation claimed…
    expect(await runStreams.activeRun('conv-target')).toBeNull();
    // …so Alice can keep chatting.
    const again = await post(alice, '/api/chat', chatBody('conv-target', 'still mine'));
    expect(again.status).toBe(200);
    await again.text();
  });
});

describe('claim store failure', () => {
  it('503s the send when the streaming backend cannot take the claim', async () => {
    const broken = new FakeRunStreamStore();
    broken.claimActiveRun = async () => {
      throw new Error('redis connection lost');
    };
    const { app } = makeApp(broken);

    const response = await post(withCookies(app), '/api/chat', chatBody('conv-x', 'hi'));
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain('Try again');
  });
});

describe('POST /api/conversations/:id/byo-runs validation', () => {
  it('400s malformed reports (wrong model prefix, missing fields, junk body)', async () => {
    const { app } = makeApp();
    const request = withCookies(app);

    const wrongPrefix = await post(request, '/api/conversations/c1/byo-runs', {
      runId: crypto.randomUUID(),
      modelId: 'anthropic/claude-haiku-4-5', // BYO reports must be byo/*
      history: [{ role: 'user', content: 'hi' }],
      assistantText: 'x',
      outcome: 'completed',
      stats: { ttftMs: 1, tokensPerSec: 1 },
      startedAt: Date.now(),
      finishedAt: Date.now(),
    });
    expect(wrongPrefix.status).toBe(400);

    expect((await post(request, '/api/conversations/c1/byo-runs', { nope: true })).status).toBe(400);
    const junk = await request('/api/conversations/c1/byo-runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(junk.status).toBe(400);
  });
});

describe('run ids are server-minted capabilities', () => {
  it('ignores the client-supplied runId: replay/stop addresses are unguessable UUIDs', async () => {
    const { app } = makeApp();
    const response = await post(withCookies(app), '/api/chat', chatBody('conv-cap', 'hi'));

    const runId = response.headers.get('x-run-id')!;
    // Never the client's id — a visitor cannot choose (or predict) the
    // address later used to replay or stop the run.
    expect(runId).not.toBe('client-chosen-run-id');
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    await response.text();
  });
});
