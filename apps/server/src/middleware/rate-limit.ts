import { createClient } from 'redis';
import type { Context, MiddlewareHandler } from 'hono';

/**
 * Per-IP token-bucket rate limiting. Buckets live in Redis so the limits
 * hold across processes; the middleware fails OPEN — a Redis hiccup must
 * never take chat down (the endpoints that truly need Redis 503 honestly
 * on their own).
 *
 * Injectable by design: tests pass an InMemoryTokenBucket and tightened
 * rules; production wires RedisTokenBucket unless CRISP_RATE_LIMIT=off.
 */

export interface RateRule {
  /** Burst size: requests allowed instantly from a fresh bucket. */
  capacity: number;
  /** Sustained rate: tokens regained per minute. */
  refillPerMinute: number;
}

export type RateRuleName = 'chat' | 'byo' | 'mutate' | 'read';
export type RateRules = Record<RateRuleName, RateRule>;

/** Team-agreed limits (see docs/plan.md discussion): burst / sustained-per-minute. */
export const RATE_RULES: RateRules = {
  chat: { capacity: 5, refillPerMinute: 15 },
  byo: { capacity: 10, refillPerMinute: 25 },
  mutate: { capacity: 15, refillPerMinute: 45 },
  read: { capacity: 30, refillPerMinute: 120 },
};

export interface RateDecision {
  allowed: boolean;
  /** How long until a token is available, when denied. */
  retryAfterMs: number;
}

export interface TokenBucketStore {
  take(key: string, rule: RateRule, nowMs: number): Promise<RateDecision>;
}

/**
 * The client IP as seen through Railway's proxy: clients can send their own
 * X-Forwarded-For, but the edge *appends* the real address — only the
 * rightmost entry is trustworthy. Local dev has no proxy; everything shares
 * one bucket, which only matters if you self-DoS your laptop.
 */
export const clientIp = (c: Context): string => {
  const forwarded = c.req.header('x-forwarded-for');
  const rightmost = forwarded?.split(',').at(-1)?.trim();
  return rightmost && rightmost.length > 0 ? rightmost : '127.0.0.1';
};

const RETRYABLE_COPY = 'Too many requests. Give it a moment and try again.';
let lastFailOpenWarn = 0;

export const rateLimit =
  (store: TokenBucketStore, name: RateRuleName, rule: RateRule): MiddlewareHandler =>
  async (c, next) => {
    let decision: RateDecision;
    try {
      decision = await store.take(`crisp:rl:${name}:${clientIp(c)}`, rule, Date.now());
    } catch (error) {
      // Fail open, warn at most once a minute — availability over strictness.
      if (Date.now() - lastFailOpenWarn > 60_000) {
        lastFailOpenWarn = Date.now();
        console.warn('[rate-limit] store unavailable, failing open:', error);
      }
      return next();
    }
    if (!decision.allowed) {
      c.header('retry-after', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
      return c.json({ error: RETRYABLE_COPY, code: 'rate_limited' }, 429);
    }
    return next();
  };

/** The bucket algorithm, shared by both stores (and their tests). */
export const drainBucket = (
  state: { tokens: number; ts: number } | null,
  rule: RateRule,
  nowMs: number,
): { tokens: number; decision: RateDecision } => {
  const refillPerMs = rule.refillPerMinute / 60_000;
  let tokens = rule.capacity;
  if (state) {
    tokens = Math.min(rule.capacity, state.tokens + Math.max(0, nowMs - state.ts) * refillPerMs);
  }
  if (tokens >= 1) {
    return { tokens: tokens - 1, decision: { allowed: true, retryAfterMs: 0 } };
  }
  return {
    tokens,
    decision: { allowed: false, retryAfterMs: Math.ceil((1 - tokens) / refillPerMs) },
  };
};

/** In-memory token buckets: unit tests and single-process fallbacks. */
export class InMemoryTokenBucket implements TokenBucketStore {
  private readonly buckets = new Map<string, { tokens: number; ts: number }>();

  async take(key: string, rule: RateRule, nowMs: number): Promise<RateDecision> {
    const { tokens, decision } = drainBucket(this.buckets.get(key) ?? null, rule, nowMs);
    this.buckets.set(key, { tokens, ts: nowMs });
    return decision;
  }
}

/**
 * Token bucket over Redis. One EVAL keeps read-modify-write atomic across
 * processes; the key expires once a full bucket would have refilled.
 */
const TAKE_SCRIPT = `
local capacity = tonumber(ARGV[1])
local refill_per_ms = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = capacity
if state[1] then
  tokens = math.min(capacity, tonumber(state[1]) + math.max(0, now - tonumber(state[2])) * refill_per_ms)
end
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill_per_ms))
local retry_ms = 0
if allowed == 0 then
  retry_ms = math.ceil((1 - tokens) / refill_per_ms)
end
return {allowed, retry_ms}
`;

const makeClient = (url: string) => createClient({ url });
type RedisClient = ReturnType<typeof makeClient>;

export class RedisTokenBucket implements TokenBucketStore {
  constructor(private readonly client: RedisClient) {}

  static async connect(url: string): Promise<RedisTokenBucket> {
    const client = makeClient(url);
    client.on('error', (error) => console.error('redis error (rate limit)', error));
    await client.connect();
    return new RedisTokenBucket(client);
  }

  async take(key: string, rule: RateRule, nowMs: number): Promise<RateDecision> {
    const refillPerMs = rule.refillPerMinute / 60_000;
    const reply = (await this.client.eval(TAKE_SCRIPT, {
      keys: [key],
      arguments: [String(rule.capacity), String(refillPerMs), String(nowMs)],
    })) as [number, number];
    return { allowed: reply[0] === 1, retryAfterMs: reply[1] };
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}
