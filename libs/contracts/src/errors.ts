import { z } from 'zod';

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
