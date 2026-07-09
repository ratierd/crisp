import { describe, expect, it } from 'vitest';
import { FakeConversationRepository } from '@crisp/conversations/testing';
import { FakeRunStreamStore } from '@crisp/runs/testing';
import { createApp } from '../src/app';
import { keyConfigFromEnv, loadEnv } from '../src/infra/env';
import { ModelRegistry } from '@crisp/models';
import { AiModelGateway } from '../src/infra/ai-gateway';
import { InMemoryTokenBucket, drainBucket } from '../src/middleware/rate-limit';
import type { RateRules, TokenBucketStore } from '../src/middleware/rate-limit';

const makeApp = (rateLimit?: { store: TokenBucketStore; rules?: Partial<RateRules> }) => {
  const env = loadEnv({});
  return createApp({
    env,
    registry: new ModelRegistry(keyConfigFromEnv(env)),
    gateway: new AiModelGateway(env, { delayMs: 0 }),
    conversations: new FakeConversationRepository(),
    runStreams: new FakeRunStreamStore(),
    ...(rateLimit ? { rateLimit } : {}),
  }).app;
};

describe('rate limiting', () => {
  it('429s with Retry-After once the bucket drains, per IP', async () => {
    const app = makeApp({
      store: new InMemoryTokenBucket(),
      rules: { read: { capacity: 2, refillPerMinute: 60 } },
    });
    const from = (ip: string) => app.request('/api/models', { headers: { 'x-forwarded-for': ip } });

    expect((await from('203.0.113.7')).status).toBe(200);
    expect((await from('203.0.113.7')).status).toBe(200);
    const limited = await from('203.0.113.7');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect((await limited.json()) as object).toMatchObject({ code: 'rate_limited' });

    // a different client is unaffected
    expect((await from('198.51.100.9')).status).toBe(200);
  });

  it('trusts only the rightmost X-Forwarded-For entry (the proxy-appended one)', async () => {
    const app = makeApp({
      store: new InMemoryTokenBucket(),
      rules: { read: { capacity: 1, refillPerMinute: 60 } },
    });
    // Same real client (rightmost) spoofing different leading entries: one bucket.
    const spoof = (fake: string) =>
      app.request('/api/models', { headers: { 'x-forwarded-for': `${fake}, 203.0.113.7` } });
    expect((await spoof('10.0.0.1')).status).toBe(200);
    expect((await spoof('10.0.0.2')).status).toBe(429);
  });

  it('fails open when the bucket store is down', async () => {
    const broken: TokenBucketStore = {
      take: async () => {
        throw new Error('redis unavailable');
      },
    };
    const app = makeApp({ store: broken, rules: { read: { capacity: 1, refillPerMinute: 60 } } });
    expect((await app.request('/api/models')).status).toBe(200);
    expect((await app.request('/api/models')).status).toBe(200);
  });

  it('leaves /api/health unlimited and is entirely off without config', async () => {
    const limited = makeApp({
      store: new InMemoryTokenBucket(),
      rules: { read: { capacity: 1, refillPerMinute: 60 } },
    });
    for (let i = 0; i < 5; i++) expect((await limited.request('/api/health')).status).toBe(200);

    const off = makeApp();
    for (let i = 0; i < 40; i++) expect((await off.request('/api/models')).status).toBe(200);
  });
});

describe('drainBucket', () => {
  const rule = { capacity: 2, refillPerMinute: 60 }; // one token per second

  it('allows bursts up to capacity, then refills over time', () => {
    const t0 = 1_000_000;
    const first = drainBucket(null, rule, t0);
    expect(first.decision.allowed).toBe(true);
    const second = drainBucket({ tokens: first.tokens, ts: t0 }, rule, t0);
    expect(second.decision.allowed).toBe(true);
    const third = drainBucket({ tokens: second.tokens, ts: t0 }, rule, t0);
    expect(third.decision.allowed).toBe(false);
    expect(third.decision.retryAfterMs).toBe(1000);
    // a second later, one token is back
    const later = drainBucket({ tokens: third.tokens, ts: t0 }, rule, t0 + 1000);
    expect(later.decision.allowed).toBe(true);
  });

  it('never refills past capacity', () => {
    const { tokens, decision } = drainBucket({ tokens: 0, ts: 0 }, rule, 3_600_000);
    expect(decision.allowed).toBe(true);
    expect(tokens).toBe(rule.capacity - 1);
  });
});

describe('body limit', () => {
  it('413s oversized bodies before they reach parsing', async () => {
    const app = makeApp();
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'conv-huge',
        messages: [
          { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'x'.repeat(300 * 1024) }] },
        ],
        forwardedProps: { modelId: 'demo/demo' },
      }),
    });
    expect(response.status).toBe(413);
  });

  it('400s a request with too many messages (zod cap)', async () => {
    const app = makeApp();
    const messages = Array.from({ length: 101 }, (_, i) => ({
      id: `u-${i}`,
      role: 'user',
      parts: [{ type: 'text', content: 'hi' }],
    }));
    const response = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        threadId: 'conv-many',
        messages,
        forwardedProps: { modelId: 'demo/demo' },
      }),
    });
    expect(response.status).toBe(400);
  });
});
