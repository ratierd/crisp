import { toServerSentEventsResponse } from '@crisp/ai';
import { Hono } from 'hono';
import { chatRequestSchema, feedbackRequestSchema } from '@crisp/contracts';
import type { StreamChunk } from '@crisp/ai';
import type { ConversationRepository, FeedbackSink, RunStreamStore } from '@crisp/domain';
import { ConversationService, RunService, TitleService } from '@crisp/domain';
import type { ModelGateway } from '@crisp/domain';
import type { Env } from './infra/env';
import type { ModelRegistry } from './infra/model-registry';
import { RunManager } from './run-manager';
import { toGatewayHistory, trailingUserMessage } from './wire';

export interface AppDeps {
  env: Env;
  registry: ModelRegistry;
  gateway: ModelGateway;
  conversations: ConversationRepository;
  runStreams: RunStreamStore;
  /** Optional observability mirror for Feedback (ADR-0005). */
  feedback?: FeedbackSink;
}

export const createApp = (deps: AppDeps) => {
  const conversationService = new ConversationService({ conversations: deps.conversations });
  const runService = new RunService({
    gateway: deps.gateway,
    conversations: deps.conversations,
    runStreams: deps.runStreams,
  });
  const titleService = new TitleService({ gateway: deps.gateway, conversations: conversationService });
  const runManager = new RunManager(runService, conversationService, titleService);

  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.get('/api/models', async (c) => c.json({ models: await deps.registry.listModels() }));

  app.get('/api/conversations', async (c) => c.json({ conversations: await conversationService.list() }));

  app.get('/api/conversations/:id', async (c) => {
    const conversation = await conversationService.get(c.req.param('id'));
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    const activeRunId = await deps.runStreams.activeRun(conversation.id);
    return c.json({ ...conversation, activeRunId });
  });

  app.delete('/api/conversations/:id', async (c) => {
    await conversationService.delete(c.req.param('id'));
    return c.body(null, 204);
  });

  app.post('/api/chat', async (c) => {
    const parsed = chatRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Malformed chat request.' }, 400);
    const { threadId: conversationId, messages, forwardedProps } = parsed.data;

    const model = await deps.registry.find(forwardedProps.modelId);
    if (!model) return c.json({ error: `Model "${forwardedProps.modelId}" is not available.` }, 400);

    if ((await deps.runStreams.activeRun(conversationId)) !== null) {
      return c.json({ error: 'A run is already live for this conversation.' }, 409);
    }

    const history = toGatewayHistory(messages);
    if (history.length === 0) return c.json({ error: 'No usable messages in request.' }, 400);

    let userMessage = trailingUserMessage(messages) ?? undefined;
    const existing = await conversationService.get(conversationId);
    if (!existing) {
      const firstUserText = history.find((m) => m.role === 'user')?.content ?? '';
      await conversationService.create(firstUserText, conversationId);
    } else if (userMessage && existing.messages.some((m) => m.id === userMessage!.id)) {
      // Regenerate/retry resends history ending at an already-persisted user
      // message: don't double-persist it, and drop the superseded answer(s).
      await deps.conversations.deleteMessagesAfter(conversationId, userMessage.id);
      userMessage = undefined;
    }

    const runId = runManager.start({ conversationId, model, history, userMessage });

    // The response streams from the RunStreamStore, not the gateway: the Run
    // itself is detached, so a dropped connection doesn't kill generation.
    const replay = deps.runStreams.replay(runId, c.req.raw.signal) as AsyncIterable<StreamChunk>;
    return toServerSentEventsResponse(replay, { headers: { 'x-run-id': runId } });
  });

  app.get('/api/runs/:runId/events', (c) => {
    const replay = deps.runStreams.replay(c.req.param('runId'), c.req.raw.signal) as AsyncIterable<StreamChunk>;
    return toServerSentEventsResponse(replay);
  });

  app.post('/api/runs/:runId/stop', (c) => {
    const stopped = runManager.stop(c.req.param('runId'));
    return c.json({ stopped }, stopped ? 200 : 404);
  });

  app.put('/api/runs/:runId/feedback', async (c) => {
    const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Malformed feedback request.' }, 400);
    const runId = c.req.param('runId');
    const feedback = parsed.data.score
      ? { score: parsed.data.score, ...(parsed.data.comment ? { comment: parsed.data.comment } : {}) }
      : null;
    const found = await deps.conversations.setFeedback(runId, feedback);
    if (!found) return c.json({ error: 'No message for that run.' }, 404);
    if (deps.feedback) void deps.feedback.record(runId, feedback); // mirror is best-effort
    return c.json({ ok: true });
  });

  return { app, runManager };
};
