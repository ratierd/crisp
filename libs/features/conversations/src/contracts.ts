import { z } from 'zod';
import { feedbackSchema } from '@crisp/feedback/contracts';

/** `system` exists for the Tour Context: one briefing Message persisted at the head of a Conversation (ADR-0009). */
export const messageRoleSchema = z.enum(['user', 'assistant', 'system']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

/** Message parts follow the AG-UI model; Crisp renders text and thinking. */
export const messagePartSchema = z.object({
  type: z.enum(['text', 'thinking']),
  content: z.string(),
});
export type MessagePart = z.infer<typeof messagePartSchema>;

/**
 * Latency shown as footnote metadata under a finished assistant Message.
 * Produced by a Run, but owned here: it lives and dies with the Message.
 */
export const runStatsSchema = z.object({
  ttftMs: z.number(),
  tokensPerSec: z.number(),
  /** Wall-clock run time; absent on messages persisted before it existed. */
  durationMs: z.number().optional(),
});
export type RunStats = z.infer<typeof runStatsSchema>;

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
