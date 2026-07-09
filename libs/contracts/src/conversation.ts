import { z } from 'zod';

export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/** Message parts follow the AG-UI model; Crisp renders text and thinking. */
export const messagePartSchema = z.object({
  type: z.enum(['text', 'thinking']),
  content: z.string(),
});
export type MessagePart = z.infer<typeof messagePartSchema>;

/** Latency shown as footnote metadata under a finished assistant Message. */
export const runStatsSchema = z.object({
  ttftMs: z.number(),
  tokensPerSec: z.number(),
  /** Wall-clock run time; absent on messages persisted before it existed. */
  durationMs: z.number().optional(),
});
export type RunStats = z.infer<typeof runStatsSchema>;

/** The user's thumbs verdict on a Run, shown on the Message it produced. */
export const feedbackSchema = z.object({
  score: z.enum(['up', 'down']),
  comment: z.string().optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** Body of PUT /api/runs/:runId/feedback. `score: null` retracts the vote. */
export const feedbackRequestSchema = z.object({
  score: z.enum(['up', 'down']).nullable(),
  comment: z.string().max(2000).optional(),
});
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;

export const messageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  parts: z.array(messagePartSchema),
  createdAt: z.string(),
  /** Assistant messages: the Model that wrote them. */
  modelId: z.string().optional(),
  /** Assistant messages: the Run that produced them — the Feedback anchor. */
  runId: z.string().optional(),
  stats: runStatsSchema.optional(),
  feedback: feedbackSchema.optional(),
  /** The Run was stopped before RUN_FINISHED; prose is partial. */
  stoppedEarly: z.boolean().optional(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationWithMessagesSchema = conversationSchema.extend({
  messages: z.array(messageSchema),
  /** Set while a Run is live so a reloading client can reattach. */
  activeRunId: z.string().nullable(),
});
export type ConversationWithMessages = z.infer<typeof conversationWithMessagesSchema>;

export const conversationListResponseSchema = z.object({
  conversations: z.array(conversationSchema),
});
export type ConversationListResponse = z.infer<typeof conversationListResponseSchema>;

/**
 * Body of POST /api/chat: the AG-UI RunAgentInput the @crisp/ai client
 * sends. `threadId` doubles as the Conversation id (client-generated);
 * `messages` cross the API untranslated (ADR-0002) — the server only relies
 * on role and text content. The selected Model travels in forwardedProps,
 * along with the user's own provider key when they brought one (BYOK):
 * it is used for this Run and never persisted or logged (ADR-0006).
 */
export const chatRequestSchema = z.looseObject({
  threadId: z.string().min(1).max(128),
  // The count cap bounds provider-call growth; per-message size is bounded
  // by the HTTP body limit (see the server's abuse-control middleware).
  messages: z.array(z.unknown()).min(1).max(100),
  forwardedProps: z.looseObject({
    modelId: z.string().min(1).max(256),
    apiKey: z.string().min(1).max(512).optional(),
  }),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** One entry of the history the browser's local gateway sent to the model. */
export const byoHistoryMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(64_000),
});

export const byoUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

/**
 * Body of POST /api/conversations/:id/byo-runs — a finished BYO-Ollama Run,
 * executed in the browser (ADR-0004), delivered for persistence and
 * observability. Mirrors what RunService records for server-side Runs.
 */
export const byoRunRequestSchema = z.object({
  runId: z.uuid(),
  modelId: z.string().startsWith('byo/').max(256),
  history: z.array(byoHistoryMessageSchema).min(1).max(100),
  /** Absent when regenerating (the user Message is already persisted). */
  userMessage: messageSchema.optional(),
  assistantText: z.string().max(131_072),
  outcome: z.enum(['completed', 'stopped', 'failed']),
  stats: runStatsSchema,
  usage: byoUsageSchema.optional(),
  startedAt: z.number(),
  finishedAt: z.number(),
  error: z.string().max(2000).optional(),
});
export type ByoRunRequest = z.infer<typeof byoRunRequestSchema>;
