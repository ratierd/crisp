// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { KEYED_PROVIDERS, loadApiKeys, saveApiKeys } from './keys';

/**
 * BYOK storage (ADR-0006): keys live in localStorage only. These tests lock
 * the storage contract — round-tripping, hostile/stale payload tolerance,
 * and that clearing every key removes the entry outright.
 */
const STORAGE_KEY = 'crisp:api-keys';

beforeEach(() => {
  localStorage.clear();
});

describe('saveApiKeys / loadApiKeys round trip', () => {
  it('persists and restores keys per provider', () => {
    saveApiKeys({ anthropic: 'sk-ant-123', openrouter: 'sk-or-456' });
    expect(loadApiKeys()).toEqual({ anthropic: 'sk-ant-123', openrouter: 'sk-or-456' });
  });

  it('uses the stable storage key the docs and devtools users rely on', () => {
    saveApiKeys({ openai: 'sk-1' });
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({ openai: 'sk-1' }));
  });

  it('drops empty-string values on save', () => {
    saveApiKeys({ anthropic: 'sk-ant-123', openai: '' });
    expect(loadApiKeys()).toEqual({ anthropic: 'sk-ant-123' });
  });

  it('removes the entry entirely when the last key is cleared', () => {
    saveApiKeys({ anthropic: 'sk-ant-123' });
    saveApiKeys({ anthropic: '' });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('loadApiKeys defends against stale or hostile storage', () => {
  it('returns {} when nothing is stored', () => {
    expect(loadApiKeys()).toEqual({});
  });

  it('returns {} on unparseable JSON instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadApiKeys()).toEqual({});
  });

  it('returns {} when the payload is not an object of strings', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('sk-loose-string'));
    expect(loadApiKeys()).toEqual({});
  });

  it('filters out providers that are no longer in the schema', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ anthropic: 'sk-keep', 'defunct-provider': 'sk-drop' }),
    );
    expect(loadApiKeys()).toEqual({ anthropic: 'sk-keep' });
  });

  it('filters out non-string and empty values', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ anthropic: 42, openai: '', openrouter: 'sk-or-1' }),
    );
    expect(loadApiKeys()).toEqual({ openrouter: 'sk-or-1' });
  });
});

describe('KEYED_PROVIDERS metadata', () => {
  it('covers exactly the providers the contracts schema knows, so picker and gateway can never disagree', () => {
    expect(KEYED_PROVIDERS.map((p) => p.id).sort()).toEqual(['anthropic', 'openai', 'openrouter']);
  });

  it('every provider ships a console URL for the "get a key" affordance', () => {
    for (const provider of KEYED_PROVIDERS) {
      expect(provider.consoleUrl).toMatch(/^https:\/\//);
      expect(provider.label.length).toBeGreaterThan(0);
      expect(provider.placeholder.length).toBeGreaterThan(0);
    }
  });
});
