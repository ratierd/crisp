import type { KeyedProvider, Model } from '@crisp/contracts';
import { keyedProviderOf } from '@crisp/contracts';
import type { Env } from './env';

export const DEMO_MODEL: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

interface ProviderCatalog {
  id: KeyedProvider;
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
      // Claude/GPT appear here *as well as* directly above: the one-click
      // OpenRouter connect (OAuth PKCE) then unlocks frontier models without
      // an Anthropic/OpenAI key.
      { name: 'anthropic/claude-sonnet-4.6', displayName: 'Claude Sonnet 4.6 (via OpenRouter)' },
      { name: 'openai/gpt-5.2', displayName: 'GPT-5.2 (via OpenRouter)' },
      { name: 'google/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash' },
      { name: 'deepseek/deepseek-chat', displayName: 'DeepSeek V3' },
    ],
  },
];

/**
 * The Model registry: remote entries gated by env-key presence, but never
 * hard-gated — a visitor's own key (BYOK, ADR-0006) lights a provider up
 * per-request. Local models are the user's own Ollama, discovered and
 * executed by the *browser* (ADR-0004) — the server never lists them.
 * `/api/models` doubles as the health check — unavailable Models carry the
 * hint the picker shows.
 */
export class ModelRegistry {
  constructor(private readonly env: Env) {}

  async listModels(): Promise<Model[]> {
    // Registry gating doubles as run gating: find() resolves from this list,
    // so a hidden Demo model is also unrunnable, not merely unlisted.
    return [...(this.env.demoEnabled ? [DEMO_MODEL] : []), ...this.remoteModels()];
  }

  /**
   * Resolves a picker id to a Model. Unknown ids return null; env-unavailable
   * ids return null too, unless the request carries the user's own key
   * (`withUserKey`) and the Model's provider accepts one.
   */
  async find(id: string, options: { withUserKey?: boolean } = {}): Promise<Model | null> {
    const models = await this.listModels();
    const model = models.find((m) => m.id === id);
    if (!model) return null;
    if (model.available) return model;
    if (options.withUserKey && keyedProviderOf(model.id) !== null) {
      const { unavailableReason: _, ...rest } = model;
      return { ...rest, available: true };
    }
    return null;
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
            : {
                unavailableReason: `Add your ${catalog.provider} API key below, or set ${catalog.envVar} on the server.`,
              }),
        }),
      );
    });
  }
}
