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
 * on role and text content. The selected Model travels in forwardedProps.
 */
export const chatRequestSchema = z.looseObject({
  threadId: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
  forwardedProps: z.looseObject({
    modelId: z.string().min(1),
  }),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;
