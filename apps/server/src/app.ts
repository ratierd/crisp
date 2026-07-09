import { toServerSentEventsResponse } from '@crisp/ai';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie } from 'hono/cookie';
import { byoRunRequestSchema, chatRequestSchema, feedbackRequestSchema } from '@crisp/contracts';
import type { MiddlewareHandler } from 'hono';
import type { StreamChunk } from '@crisp/ai';
import type { ConversationRepository, FeedbackSink, RunMirror, RunStreamStore } from '@crisp/domain';
import { ConversationService, RunService, TitleService } from '@crisp/domain';
import type { ModelGateway } from '@crisp/domain';
import type { Env } from './infra/env';
import type { ModelRegistry } from './infra/model-registry';
import { RATE_RULES, rateLimit } from './middleware/rate-limit';
import type { RateRuleName, RateRules, TokenBucketStore } from './middleware/rate-limit';
import { RunManager } from './run-manager';
import { toGatewayHistory, trailingUserMessage } from './wire';

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

type AppEnv = { Variables: { owner: string } };

export interface AppDeps {
  env: Env;
  registry: ModelRegistry;
  gateway: ModelGateway;
  conversations: ConversationRepository;
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
  const conversationService = new ConversationService({ conversations: deps.conversations });
  const runService = new RunService({
    gateway: deps.gateway,
    conversations: deps.conversations,
    runStreams: deps.runStreams,
  });
  const titleService = new TitleService({ gateway: deps.gateway, conversations: conversationService });
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
        new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
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
  const guard = (name: RateRuleName): MiddlewareHandler =>
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

  app.get('/api/models', guard('read'), async (c) => c.json({ models: await deps.registry.listModels() }));

  app.get('/api/conversations', guard('read'), async (c) =>
    c.json({ conversations: await conversationService.list(c.get('owner')) }),
  );

  app.get('/api/conversations/:id', guard('read'), async (c) => {
    const conversation = await conversationService.get(c.req.param('id'), c.get('owner'));
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    const activeRunId = await deps.runStreams.activeRun(conversation.id);
    return c.json({ ...conversation, activeRunId });
  });

  app.delete('/api/conversations/:id', guard('mutate'), async (c) => {
    await conversationService.delete(c.req.param('id'), c.get('owner'));
    return c.body(null, 204);
  });

  app.post('/api/chat', guard('chat'), async (c) => {
    const parsed = chatRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Malformed chat request.' }, 400);
    const { threadId: conversationId, messages, forwardedProps } = parsed.data;

    // BYOK (ADR-0006): a user-supplied key makes an env-unavailable Model
    // usable for this request. The key is handed to the gateway and dropped.
    const userApiKey = forwardedProps.apiKey;
    const model = await deps.registry.find(forwardedProps.modelId, { withUserKey: userApiKey !== undefined });
    if (!model) return c.json({ error: `Model "${forwardedProps.modelId}" is not available.` }, 400);

    const history = toGatewayHistory(messages);
    if (history.length === 0) return c.json({ error: 'No usable messages in request.' }, 400);

    // One live Run per Conversation, enforced atomically: the claim happens
    // before any mutation, and two concurrent sends can never both win it.
    // RunManager releases the claim on every exit path of the Run.
    const runId = crypto.randomUUID();
    let claimed: boolean;
    try {
      claimed = await deps.runStreams.claimActiveRun(conversationId, runId);
    } catch {
      return c.json({ error: 'Streaming backend unavailable. Try again shortly.' }, 503);
    }
    if (!claimed) return c.json({ error: 'A run is already live for this conversation.' }, 409);

    try {
      const owner = c.get('owner');
      let userMessage = trailingUserMessage(messages) ?? undefined;
      const existing = await conversationService.get(conversationId, owner);
      if (!existing) {
        const firstUserText = history.find((m) => m.role === 'user')?.content ?? '';
        try {
          await conversationService.create(firstUserText, owner, conversationId);
        } catch {
          // The id exists under another visitor — refuse, release the claim.
          await deps.runStreams.releaseActiveRun(conversationId, runId).catch(() => {});
          return c.json({ error: 'Conversation id is unavailable.' }, 409);
        }
      } else if (userMessage && existing.messages.some((m) => m.id === userMessage!.id)) {
        // Regenerate/retry resends history ending at an already-persisted user
        // message: don't double-persist it, and drop the superseded answer(s).
        await deps.conversations.deleteMessagesAfter(conversationId, userMessage.id);
        userMessage = undefined;
      }

      runManager.start({
        conversationId,
        runId,
        owner,
        model,
        history,
        userMessage,
        ...(userApiKey ? { apiKey: userApiKey } : {}),
      });
    } catch (error) {
      // The Run never started — don't leave the conversation claimed.
      await deps.runStreams.releaseActiveRun(conversationId, runId).catch(() => {});
      throw error;
    }

    // The response streams from the RunStreamStore, not the gateway: the Run
    // itself is detached, so a dropped connection doesn't kill generation.
    const replay = deps.runStreams.replay(runId, c.req.raw.signal) as AsyncIterable<StreamChunk>;
    return toServerSentEventsResponse(replay, { headers: { 'x-run-id': runId } });
  });

  // A BYO-Ollama Run executed in the browser (ADR-0004): persist the
  // exchange exactly as RunService would, then mirror it to observability.
  app.post('/api/conversations/:id/byo-runs', guard('byo'), async (c) => {
    const parsed = byoRunRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Malformed BYO run report.' }, 400);
    const conversationId = c.req.param('id');
    const report = parsed.data;

    const owner = c.get('owner');
    let userMessage = report.userMessage;
    const existing = await conversationService.get(conversationId, owner);
    // Idempotency: the browser may retry a report that already landed. The
    // runId is the natural dedupe key — same run, same message, no-op.
    if (existing?.messages.some((m) => m.runId === report.runId)) {
      return c.json({ ok: true, deduped: true });
    }
    if (!existing) {
      const firstUserText = report.history.find((m) => m.role === 'user')?.content ?? '';
      try {
        await conversationService.create(firstUserText, owner, conversationId);
      } catch {
        // The id exists under another visitor (scoped get can't see it):
        // refuse rather than write into someone else's conversation.
        return c.json({ error: 'Conversation id is unavailable.' }, 409);
      }
    } else if (userMessage && existing.messages.some((m) => m.id === userMessage!.id)) {
      // regenerate resends history ending at an already-persisted user message
      await deps.conversations.deleteMessagesAfter(conversationId, userMessage.id);
      userMessage = undefined;
    }
    if (userMessage) await deps.conversations.appendMessage(conversationId, userMessage);

    // like RunService: keep the assistant Message when text arrived, even stopped
    if (report.assistantText.length > 0 && report.outcome !== 'failed') {
      await deps.conversations.appendMessage(conversationId, {
        id: crypto.randomUUID(),
        role: 'assistant',
        parts: [{ type: 'text', content: report.assistantText }],
        createdAt: new Date(report.finishedAt).toISOString(),
        modelId: report.modelId,
        runId: report.runId,
        stats: report.stats,
        ...(report.outcome === 'stopped' ? { stoppedEarly: true } : {}),
      });
    }

    if (deps.runMirror) {
      const modelName = report.modelId.slice('byo/'.length);
      void deps.runMirror.record({
        runId: report.runId,
        conversationId,
        model: {
          id: report.modelId,
          displayName: modelName,
          provider: 'Ollama (yours)',
          provenance: 'local',
          available: true,
        },
        messages: report.history,
        assistantText: report.assistantText,
        outcome: report.outcome,
        usage: report.usage,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        error: report.error,
      });
    }

    return c.json({ ok: true });
  });

  app.get('/api/runs/:runId/events', guard('read'), (c) => {
    const replay = deps.runStreams.replay(c.req.param('runId'), c.req.raw.signal) as AsyncIterable<StreamChunk>;
    return toServerSentEventsResponse(replay);
  });

  // Idempotent: stopping an already-finished (or unknown) run is not an
  // error — the desired state ("not running") already holds.
  app.post('/api/runs/:runId/stop', guard('mutate'), (c) => {
    const stopped = runManager.stop(c.req.param('runId'));
    return c.json({ stopped });
  });

  app.put('/api/runs/:runId/feedback', guard('mutate'), async (c) => {
    const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Malformed feedback request.' }, 400);
    const runId = c.req.param('runId');
    const feedback = parsed.data.score
      ? { score: parsed.data.score, ...(parsed.data.comment ? { comment: parsed.data.comment } : {}) }
      : null;
    const found = await deps.conversations.setFeedback(runId, feedback, c.get('owner'));
    if (!found) return c.json({ error: 'No message for that run.' }, 404);
    if (deps.feedback) void deps.feedback.record(runId, feedback); // mirror is best-effort
    return c.json({ ok: true });
  });

  return { app, runManager };
};
