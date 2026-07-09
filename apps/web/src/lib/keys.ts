import type { KeyedProvider } from '@crisp/models/contracts';
import { keyedProviderSchema } from '@crisp/models/contracts';

/**
 * BYOK (ADR-0006): visitors paste their own provider keys to chat on their
 * account against a deployed Crisp. Keys live in this browser's localStorage
 * only; each chat request carries the one key its Model needs, the server
 * uses it for that Run and drops it.
 */

const STORAGE_KEY = 'crisp:api-keys';

export type ApiKeys = Partial<Record<KeyedProvider, string>>;

export interface KeyedProviderMeta {
  id: KeyedProvider;
  label: string;
  placeholder: string;
  /** Where to create a key. */
  consoleUrl: string;
}

export const KEYED_PROVIDERS: KeyedProviderMeta[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    placeholder: 'sk-ant-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    placeholder: 'sk-…',
    consoleUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    placeholder: 'sk-or-…',
    consoleUrl: 'https://openrouter.ai/settings/keys',
  },
];

export const loadApiKeys = (): ApiKeys => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const keys: ApiKeys = {};
    for (const [provider, value] of Object.entries(parsed)) {
      const id = keyedProviderSchema.safeParse(provider);
      if (id.success && typeof value === 'string' && value.length > 0) keys[id.data] = value;
    }
    return keys;
  } catch {
    return {};
  }
};

export const saveApiKeys = (keys: ApiKeys): void => {
  const entries = Object.entries(keys).filter(([, value]) => value && value.length > 0);
  if (entries.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
};
