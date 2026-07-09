import type { Hono } from 'hono';
import { readWireMessages, toServerSentEventsResponse } from '@crisp/ai';
import type { StreamChunk } from '@crisp/ai';
import type { ConversationService } from '@crisp/conversations';
import type { ModelRegistry } from '@crisp/models';
import { byoRunRequestSchema, chatRequestSchema } from '@crisp/runs';
import type { MessageStore, RunMirror, RunStreamStore } from '@crisp/runs';
import type { AppEnv, Guard } from '../app';
import type { RunManager } from '../run-manager';

export interface RunRoutesDeps {
  guard: Guard;
  registry: ModelRegistry;
  conversations: ConversationService;
  messages: MessageStore;
  runStreams: RunStreamStore;
  runManager: RunManager;
  /** Optional observability mirror for browser-executed Runs (ADR-0004). */
  runMirror?: RunMirror | undefined;
}

export const registerRunRoutes = (app: Hono<AppEnv>, deps: RunRoutesDeps) => {
  app.post('/api/chat', deps.guard('chat'), async (c) => {
    const parsed = chatRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Malformed chat request.' }, 400);
    const { threadId: conversationId, messages, forwardedProps } = parsed.data;

    // BYOK (ADR-0006): a user-supplied key makes an env-unavailable Model
    // usable for this request. The key is handed to the gateway and dropped.
    const userApiKey = forwardedProps.apiKey;
    const model = await deps.registry.find(forwardedProps.modelId, {
      withUserKey: userApiKey !== undefined,
    });
    if (!model)
      return c.json({ error: `Model "${forwardedProps.modelId}" is not available.` }, 400);

    // One reading (@crisp/ai wire codec): the history the Model runs and the
    // user Message persisted below can never come from divergent parses.
    const { history, trailingUserMessage, leadingSystemMessage } = readWireMessages(messages);
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
      let userMessage = trailingUserMessage ?? undefined;
      const existing = await deps.conversations.get(conversationId, owner);
      if (!existing) {
        const firstUserText = history.find((m) => m.role === 'user')?.content ?? '';
        try {
          await deps.conversations.create(firstUserText, owner, conversationId);
        } catch {
          // The id exists under another visitor — refuse, release the claim.
          await deps.runStreams.releaseActiveRun(conversationId, runId).catch(() => {});
          return c.json({ error: 'Conversation id is unavailable.' }, 409);
        }
        // Tour Mode (ADR-0009): a Conversation opened with a Tour Context
        // keeps it — persisted once, at creation, ahead of the first exchange.
        if (leadingSystemMessage) {
          await deps.messages.appendMessage(conversationId, leadingSystemMessage);
        }
      } else if (userMessage && existing.messages.some((m) => m.id === userMessage!.id)) {
        // Regenerate/retry resends history ending at an already-persisted user
        // message: don't double-persist it, and drop the superseded answer(s).
        await deps.messages.deleteMessagesAfter(conversationId, userMessage.id);
        userMessage = undefined;
      }

      deps.runManager.start({
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
  app.post('/api/conversations/:id/byo-runs', deps.guard('byo'), async (c) => {
    const parsed = byoRunRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Malformed BYO run report.' }, 400);
    const conversationId = c.req.param('id');
    const report = parsed.data;

    const owner = c.get('owner');
    let userMessage = report.userMessage;
    const existing = await deps.conversations.get(conversationId, owner);
    // Idempotency: the browser may retry a report that already landed. The
    // runId is the natural dedupe key — same run, same message, no-op.
    if (existing?.messages.some((m) => m.runId === report.runId)) {
      return c.json({ ok: true, deduped: true });
    }
    if (!existing) {
      const firstUserText = report.history.find((m) => m.role === 'user')?.content ?? '';
      try {
        await deps.conversations.create(firstUserText, owner, conversationId);
      } catch {
        // The id exists under another visitor (scoped get can't see it):
        // refuse rather than write into someone else's conversation.
        return c.json({ error: 'Conversation id is unavailable.' }, 409);
      }
      // Tour Mode (ADR-0009): same rule as /api/chat — the Tour Context the
      // run opened with is persisted once, when the report creates the
      // Conversation.
      if (report.systemMessage) {
        await deps.messages.appendMessage(conversationId, report.systemMessage);
      }
    } else if (userMessage && existing.messages.some((m) => m.id === userMessage!.id)) {
      // regenerate resends history ending at an already-persisted user message
      await deps.messages.deleteMessagesAfter(conversationId, userMessage.id);
      userMessage = undefined;
    }
    if (userMessage) await deps.messages.appendMessage(conversationId, userMessage);

    // like RunService: keep the assistant Message when text arrived, even stopped
    if (report.assistantText.length > 0 && report.outcome !== 'failed') {
      await deps.messages.appendMessage(conversationId, {
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

  app.get('/api/runs/:runId/events', deps.guard('read'), (c) => {
    const replay = deps.runStreams.replay(
      c.req.param('runId'),
      c.req.raw.signal,
    ) as AsyncIterable<StreamChunk>;
    return toServerSentEventsResponse(replay);
  });

  // Idempotent: stopping an already-finished (or unknown) run is not an
  // error — the desired state ("not running") already holds.
  app.post('/api/runs/:runId/stop', deps.guard('mutate'), (c) => {
    const stopped = deps.runManager.stop(c.req.param('runId'));
    return c.json({ stopped });
  });
};
