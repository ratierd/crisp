import type { Model } from '@crisp/contracts';
import type { Env } from './env';

export const DEMO_MODEL: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

interface ProviderCatalog {
  id: 'anthropic' | 'openai' | 'openrouter';
  provider: string;
  envVar: string;
  envKey: (env: Env) => string | null;
  models: ReadonlyArray<{ name: string; displayName: string }>;
}

const CATALOGS: ProviderCatalog[] = [
  {
    id: 'anthropic',
    provider: 'Anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    envKey: (env) => env.anthropicApiKey,
    models: [
      { name: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6' },
      { name: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    provider: 'OpenAI',
    envVar: 'OPENAI_API_KEY',
    envKey: (env) => env.openaiApiKey,
    models: [
      { name: 'gpt-5.2', displayName: 'GPT-5.2' },
      { name: 'gpt-5-mini', displayName: 'GPT-5 mini' },
    ],
  },
  {
    // OpenRouter model names keep their own `vendor/model` form, so full ids
    // are e.g. "openrouter/deepseek/deepseek-chat" — only the first segment
    // is Crisp's provider id.
    id: 'openrouter',
    provider: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    envKey: (env) => env.openrouterApiKey,
    models: [
      { name: 'openrouter/auto', displayName: 'Auto Router' },
      { name: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { name: 'deepseek/deepseek-chat', displayName: 'DeepSeek V3' },
    ],
  },
];

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
    return CATALOGS.flatMap((catalog) => {
      const hasServerKey = catalog.envKey(this.env) !== null;
      return catalog.models.map(
        (entry): Model => ({
          id: `${catalog.id}/${entry.name}`,
          displayName: entry.displayName,
          provider: catalog.provider,
          provenance: 'remote',
          available: hasServerKey,
          ...(hasServerKey
            ? {}
            : { unavailableReason: `${catalog.envVar} is missing from the environment.` }),
        }),
      );
    });
  }
}
