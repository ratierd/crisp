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

interface OllamaTag {
  name: string;
}

/**
 * The Model registry: remote entries gated by env-key presence, local
 * entries discovered from the Ollama daemon. `/api/models` doubles as the
 * health check — unavailable Models carry the hint the picker shows.
 */
export class ModelRegistry {
  constructor(
    private readonly env: Env,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async listModels(): Promise<Model[]> {
    const [ollama, remote] = await Promise.all([this.ollamaModels(), this.remoteModels()]);
    return [DEMO_MODEL, ...ollama, ...remote];
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

  private async ollamaModels(): Promise<Model[]> {
    const down: Model = {
      id: 'ollama/unavailable',
      displayName: 'Ollama',
      provider: 'Ollama',
      provenance: 'local',
      available: false,
      unavailableReason: "Ollama isn't running — start it, then reopen this menu.",
    };
    try {
      const response = await this.fetchFn(`${this.env.ollamaBaseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1500),
      });
      if (!response.ok) return [down];
      const body = (await response.json()) as { models?: OllamaTag[] };
      const tags = body.models ?? [];
      if (tags.length === 0) {
        return [
          {
            ...down,
            id: 'ollama/none',
            unavailableReason: 'No local models installed — try `ollama pull llama3.2`.',
          },
        ];
      }
      return tags.map(
        (tag): Model => ({
          id: `ollama/${tag.name}`,
          displayName: tag.name,
          provider: 'Ollama',
          provenance: 'local',
          available: true,
        }),
      );
    } catch {
      return [down];
    }
  }
}
