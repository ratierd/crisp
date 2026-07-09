import { describe, expect, it } from 'vitest';
import { keyedProviderOf, modelSchema } from './contracts';
import type { KeyConfig } from './ports';
import { ModelRegistry } from './registry';

const keys = (config: { demo?: boolean; providers?: string[] } = {}): KeyConfig => ({
  demoEnabled: config.demo ?? true,
  serverKeyFor: (provider) => (config.providers?.includes(provider) ? 'sk-server' : null),
});

describe('modelSchema', () => {
  it('requires provenance to be local or remote', () => {
    expect(
      modelSchema.safeParse({
        id: 'x/y',
        displayName: 'X',
        provider: 'X',
        provenance: 'cloud',
        available: true,
      }).success,
    ).toBe(false);
  });
});

describe('keyedProviderOf', () => {
  it('maps a Model id to its BYOK provider, or null for keyless models', () => {
    expect(keyedProviderOf('anthropic/claude-haiku-4-5')).toBe('anthropic');
    expect(keyedProviderOf('openrouter/deepseek/deepseek-chat')).toBe('openrouter');
    expect(keyedProviderOf('demo/demo')).toBeNull();
    expect(keyedProviderOf('byo/llama3.2:3b')).toBeNull();
  });
});

describe('ModelRegistry', () => {
  it('lists remote Models as unavailable with a hint when no server key exists', async () => {
    const registry = new ModelRegistry(keys());
    const models = await registry.listModels();
    const anthropic = models.find((m) => m.id === 'anthropic/claude-haiku-4-5')!;
    expect(anthropic.available).toBe(false);
    expect(anthropic.unavailableReason).toContain('ANTHROPIC_API_KEY');
  });

  it('a server key lights up the whole provider catalog', async () => {
    const registry = new ModelRegistry(keys({ providers: ['anthropic'] }));
    const models = await registry.listModels();
    expect(models.find((m) => m.id === 'anthropic/claude-haiku-4-5')!.available).toBe(true);
    expect(models.find((m) => m.id === 'openai/gpt-5-mini')!.available).toBe(false);
  });

  it('hides the demo Model entirely when disabled — unlisted means unrunnable', async () => {
    const registry = new ModelRegistry(keys({ demo: false }));
    expect(await registry.find('demo/demo')).toBeNull();
  });

  it('find() honors BYOK: a user key resolves an env-unavailable Model', async () => {
    const registry = new ModelRegistry(keys());
    expect(await registry.find('anthropic/claude-haiku-4-5')).toBeNull();
    const withKey = await registry.find('anthropic/claude-haiku-4-5', { withUserKey: true });
    expect(withKey).toMatchObject({ available: true });
    expect(withKey!.unavailableReason).toBeUndefined();
    // demo/byo Models take no key — a user key resolves nothing extra
    expect(await registry.find('byo/llama3.2:3b', { withUserKey: true })).toBeNull();
  });
});
