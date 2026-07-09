import { z } from 'zod';

/** Where a Model executes. A property of the Model, invisible to domain logic. */
export const provenanceSchema = z.enum(['local', 'remote']);
export type Provenance = z.infer<typeof provenanceSchema>;

export const modelSchema = z.object({
  /** Registry id, e.g. "anthropic/claude-haiku-4-5" or "demo/demo". */
  id: z.string(),
  displayName: z.string(),
  /** Human provider name, used in error copy and picker grouping. */
  provider: z.string(),
  provenance: provenanceSchema,
  /** False when the provider failed its health check; the picker disables the row. */
  available: z.boolean(),
  /** Picker hint explaining why the Model is disabled. */
  unavailableReason: z.string().optional(),
});
export type Model = z.infer<typeof modelSchema>;

export const modelsResponseSchema = z.object({
  models: z.array(modelSchema),
});
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

/**
 * Remote providers that accept a user-supplied API key (BYOK): a visitor
 * pastes their own key in the picker and their chats bill their account.
 * Shared by the registry (availability), the gateway (key precedence) and
 * the web picker (key inputs), so the three can never disagree.
 */
export const keyedProviderSchema = z.enum(['anthropic', 'openai', 'openrouter']);
export type KeyedProvider = z.infer<typeof keyedProviderSchema>;

/** The provider segment of a Model id ("anthropic/claude-…" → "anthropic"). */
export const providerIdOf = (modelId: string): string => modelId.split('/')[0] ?? '';

/** The KeyedProvider a Model id belongs to, or null for demo/byo models. */
export const keyedProviderOf = (modelId: string): KeyedProvider | null => {
  const parsed = keyedProviderSchema.safeParse(providerIdOf(modelId));
  return parsed.success ? parsed.data : null;
};
