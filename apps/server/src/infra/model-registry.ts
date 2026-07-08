import type { Model } from '@crisp/contracts';
import type { Env } from './env';

export const DEMO_MODEL: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

const ANTHROPIC_CATALOG = [
  { name: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
  { name: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
] as const;

const OPENAI_CATALOG = [
  { name: 'gpt-5.2', displayName: 'GPT-5.2' },
  { name: 'gpt-5-mini', displayName: 'GPT-5 mini' },
] as const;

/**
 * The Model registry: remote entries gated by env-key presence. Local models
 * are the user's own Ollama, discovered and executed by the *browser*
 * (ADR-0004) — the server never lists them. `/api/models` doubles as the
 * health check — unavailable Models carry the hint the picker shows.
 */
export class ModelRegistry {
  constructor(private readonly env: Env) {}

  async listModels(): Promise<Model[]> {
    return [DEMO_MODEL, ...this.remoteModels()];
  }

  /** Resolves a picker id to a Model; unavailable and unknown ids return null. */
  async find(id: string): Promise<Model | null> {
    const models = await this.listModels();
    const model = models.find((m) => m.id === id);
    return model?.available ? model : null;
  }

  private remoteModels(): Model[] {
    const anthropic = ANTHROPIC_CATALOG.map(
      (entry): Model => ({
        id: `anthropic/${entry.name}`,
        displayName: entry.displayName,
        provider: 'Anthropic',
        provenance: 'remote',
        available: this.env.anthropicApiKey !== null,
        ...(this.env.anthropicApiKey === null
          ? { unavailableReason: 'ANTHROPIC_API_KEY is missing from the environment.' }
          : {}),
      }),
    );
    const openai = OPENAI_CATALOG.map(
      (entry): Model => ({
        id: `openai/${entry.name}`,
        displayName: entry.displayName,
        provider: 'OpenAI',
        provenance: 'remote',
        available: this.env.openaiApiKey !== null,
        ...(this.env.openaiApiKey === null
          ? { unavailableReason: 'OPENAI_API_KEY is missing from the environment.' }
          : {}),
      }),
    );
    return [...anthropic, ...openai];
  }
}
