import { z } from 'zod';
import { messageSchema, runStatsSchema } from '@crisp/conversations/contracts';

/**
 * An AG-UI streaming event. Events cross the hexagon untranslated (ADR-0002);
 * this slice only inspects the discriminant and a few well-known fields.
 */
export interface RunEvent {
  type: string;
  [key: string]: unknown;
}

/** Chat-shaped input for a Run, already flattened for the gateway. */
export interface GatewayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Typed error taxonomy carried by AG-UI RUN_ERROR events (as `code`).
 * The web app picks the error-card copy from this kind.
 */
export const runErrorKindSchema = z.enum([
  'provider_unavailable',
  'auth_failed',
  'rate_limited',
  'aborted',
  'unknown',
]);
export type RunErrorKind = z.infer<typeof runErrorKindSchema>;

export const runErrorSchema = z.object({
  kind: runErrorKindSchema,
  /** Human provider name for error copy: "Ollama", "Anthropic", "OpenAI", "the demo provider". */
  provider: z.string(),
  message: z.string(),
});
export type RunError = z.infer<typeof runErrorSchema>;

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
  /** The Tour Context the run opened with — persisted if this report creates the Conversation (ADR-0009). */
  systemMessage: messageSchema.optional(),
  assistantText: z.string().max(131_072),
  outcome: z.enum(['completed', 'stopped', 'failed']),
  stats: runStatsSchema,
  usage: byoUsageSchema.optional(),
  startedAt: z.number(),
  finishedAt: z.number(),
  error: z.string().max(2000).optional(),
});
export type ByoRunRequest = z.infer<typeof byoRunRequestSchema>;
