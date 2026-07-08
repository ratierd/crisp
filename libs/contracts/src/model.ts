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
