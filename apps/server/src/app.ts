import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { ConversationService } from '@crisp/conversations';
import type { ConversationRepository } from '@crisp/conversations';
import { FeedbackService } from '@crisp/feedback';
import type { FeedbackSink, FeedbackStore } from '@crisp/feedback';
import type { ModelRegistry } from '@crisp/models';
import { RunService } from '@crisp/runs';
import type { MessageStore, ModelGateway, RunMirror, RunStreamStore } from '@crisp/runs';
import { TitleService } from '@crisp/titling';
import type { ConversationRenamer } from '@crisp/titling';
import type { Env } from './infra/env';
import { RATE_RULES, rateLimit } from './middleware/rate-limit';
import type { RateRuleName, RateRules, TokenBucketStore } from './middleware/rate-limit';
import { registerConversationRoutes } from './routes/conversations';
import { registerFeedbackRoutes } from './routes/feedback';
import { registerModelRoutes } from './routes/models';
import { registerRunRoutes } from './routes/runs';
import { RunManager } from './run-manager';

/** Generous for chat history, hostile to memory-exhaustion bodies. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Anonymous visitor identity: an unguessable id in an HttpOnly cookie,
 * minted on first API contact. It is a bearer capability, not an account —
 * Conversations are scoped to it so visitors of the hosted instance can't
 * read or delete each other's history. Deliberately unsigned: guessing
 * another visitor's 122-bit random id is the attack, and signing doesn't
 * make it harder.
 */
const SID_COOKIE = 'crisp_sid';
const SID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export type AppEnv = { Variables: { owner: string } };

/** Per-IP rate limiting per route class, resolved from AppDeps by createApp. */
export type Guard = (name: RateRuleName) => MiddlewareHandler;

/**
 * The one durable-storage adapter, seen through every slice's port at once:
 * the conversations slice reads and deletes through ConversationRepository,
 * the runs slice writes Messages through MessageStore, feedback records
 * verdicts through FeedbackStore, and titling renames through
 * ConversationRenamer. Each slice declared only the sliver it needs; the
 * SQLite adapter (and its in-memory fake) satisfies the whole intersection.
 */
export type ConversationPersistence = ConversationRepository &
  MessageStore &
  FeedbackStore &
  ConversationRenamer;

export interface AppDeps {
  env: Env;
  registry: ModelRegistry;
  gateway: ModelGateway;
  conversations: ConversationPersistence;
  runStreams: RunStreamStore;
  /** Optional observability mirror for Feedback (ADR-0005). */
  feedback?: FeedbackSink;
  /** Optional observability mirror for browser-executed Runs (ADR-0004). */
  runMirror?: RunMirror;
  /**
   * Liveness probes for GET /api/health. Each throws when its backend is
   * down. Absent probes count as healthy (test fixtures, demo wiring).
   */
  probes?: {
    redis?: () => Promise<void>;
    db?: () => Promise<void>;
  };
  /**
   * Per-IP rate limiting. Absent means off (test fixtures, CRISP_RATE_LIMIT=off);
   * `rules` overrides the defaults per route class (tests tighten them).
   */
  rateLimit?: {
    store: TokenBucketStore;
    rules?: Partial<RateRules>;
  };
}

export const createApp = (deps: AppDeps) => {
  // Composition root for the feature slices: the same gateway serves runs
  // and titling; the same storage adapter serves four slices (see
  // ConversationPersistence above).
  const conversationService = new ConversationService({ conversations: deps.conversations });
  const runService = new RunService({
    gateway: deps.gateway,
    messages: deps.conversations,
    runStreams: deps.runStreams,
  });
  const titleService = new TitleService({
    model: deps.gateway,
    conversations: deps.conversations,
  });
  const feedbackService = new FeedbackService({
    store: deps.conversations,
    sink: deps.feedback,
  });
  const runManager = new RunManager(runService, conversationService, titleService, deps.runStreams);

  const app = new Hono<AppEnv>();

  // Runs can stream for minutes; API responses must never be cached.
  app.use('/api/*', async (c, next) => {
    await next();
    c.res.headers.set('cache-control', 'no-store');
  });

  // Visitor session: reuse a valid crisp_sid, mint one otherwise. The header
  // is appended AFTER next(): handlers that return a raw Response (the SSE
  // streams) bypass Hono's context headers, so setCookie() would be dropped.
  app.use('/api/*', async (c, next) => {
    let sid = getCookie(c, SID_COOKIE);
    const minted = !sid || !SID_PATTERN.test(sid);
    if (minted) sid = crypto.randomUUID();
    c.set('owner', sid!);
    await next();
    if (minted) {
      // Behind a TLS-terminating edge (Railway) the request URL is http;
      // the edge asserts the original scheme via X-Forwarded-Proto.
      const https =
        new URL(c.req.url).protocol === 'https:' ||
        c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
      const secure = https ? '; Secure' : '';
      c.res.headers.append(
        'set-cookie',
        `${SID_COOKIE}=${sid}; Path=/; Max-Age=${SID_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
      );
    }
  });

  // Abuse controls: a hard body-size ceiling on every mutating endpoint,
  // and per-IP token buckets per route class. `guard` is a no-op when rate
  // limiting is not wired (tests, kill-switch).
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => c.json({ error: 'Request body too large.' }, 413),
    }),
  );
  const rules: RateRules = { ...RATE_RULES, ...deps.rateLimit?.rules };
  const passthrough: MiddlewareHandler = (_c, next) => next();
  const guard: Guard = (name) =>
    deps.rateLimit ? rateLimit(deps.rateLimit.store, name, rules[name]) : passthrough;

  // Honest health: chat is down when Redis is down, history when SQLite is.
  // startedAt lets tooling verify it is talking to a fresh process.
  const startedAt = new Date().toISOString();
  const probe = async (check?: () => Promise<void>) => {
    if (!check) return true;
    try {
      await check();
      return true;
    } catch {
      return false;
    }
  };
  app.get('/api/health', async (c) => {
    const [redis, db] = await Promise.all([probe(deps.probes?.redis), probe(deps.probes?.db)]);
    const ok = redis && db;
    return c.json({ ok, redis, db, startedAt }, ok ? 200 : 503);
  });

  // One route module per feature slice; each gets only what it composes.
  registerModelRoutes(app, { guard, registry: deps.registry });
  registerConversationRoutes(app, {
    guard,
    conversations: conversationService,
    runStreams: deps.runStreams,
  });
  registerRunRoutes(app, {
    guard,
    registry: deps.registry,
    conversations: conversationService,
    messages: deps.conversations,
    runStreams: deps.runStreams,
    runManager,
    runMirror: deps.runMirror,
  });
  registerFeedbackRoutes(app, { guard, feedback: feedbackService });

  return { app, runManager };
};
