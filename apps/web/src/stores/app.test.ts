// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { Model } from '@crisp/contracts';

const mocks = vi.hoisted(() => ({
  getModels: vi.fn(async (): Promise<Model[]> => []),
  listConversations: vi.fn(async () => []),
  deleteConversation: vi.fn(async () => undefined),
  discoverByoModels: vi.fn(async (): Promise<Model[]> => []),
  shouldAutoDiscover: vi.fn((): boolean => false),
}));

vi.mock('../lib/api', () => ({
  getModels: mocks.getModels,
  listConversations: mocks.listConversations,
  deleteConversation: mocks.deleteConversation,
}));
vi.mock('../lib/byo', () => ({
  discoverByoModels: mocks.discoverByoModels,
  shouldAutoDiscover: mocks.shouldAutoDiscover,
}));

import { SIDEBAR_MAX, SIDEBAR_MIN, useAppStore } from './app';

/** jsdom has no matchMedia; the store reads it at state() creation. */
const stubMatchMedia = ({ narrow = false, darkSystem = false } = {}) => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query.includes('max-width') ? narrow : darkSystem,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
};

const model = (id: string, overrides: Partial<Model> = {}): Model => ({
  id,
  displayName: id,
  provider: 'Anthropic',
  provenance: 'remote',
  available: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  stubMatchMedia();
  setActivePinia(createPinia());
});

describe('initial layout state (CLS guard)', () => {
  it('derives narrow from the 779px media query and starts with the sidebar closed when narrow', () => {
    stubMatchMedia({ narrow: true });
    const store = useAppStore();
    expect(store.narrow).toBe(true);
    expect(store.sidebarOpen).toBe(false);
  });

  it('starts wide with the sidebar open', () => {
    const store = useAppStore();
    expect(store.narrow).toBe(false);
    expect(store.sidebarOpen).toBe(true);
  });
});

describe('loadModels probe gating (ADR-0004)', () => {
  it('skips the Ollama probe when not forced and auto-discovery is off', async () => {
    mocks.shouldAutoDiscover.mockReturnValue(false);
    await useAppStore().loadModels();
    expect(mocks.discoverByoModels).not.toHaveBeenCalled();
  });

  it('probes when auto-discovery says the probe can plausibly succeed', async () => {
    mocks.shouldAutoDiscover.mockReturnValue(true);
    await useAppStore().loadModels();
    expect(mocks.discoverByoModels).toHaveBeenCalledTimes(1);
  });

  it('probeByo=true (picker open) forces the probe even on a deployed origin', async () => {
    mocks.shouldAutoDiscover.mockReturnValue(false);
    await useAppStore().loadModels(true);
    expect(mocks.discoverByoModels).toHaveBeenCalledTimes(1);
  });

  it('appends discovered BYO models and flips byoConnected', async () => {
    mocks.getModels.mockResolvedValue([model('demo/demo', { provider: 'Demo', provenance: 'local' })]);
    mocks.discoverByoModels.mockResolvedValue([model('byo/llama3.2:3b', { provider: 'Ollama (yours)', provenance: 'local' })]);
    const store = useAppStore();
    await store.loadModels(true);
    expect(store.byoConnected).toBe(true);
    expect(store.models.map((m) => m.id)).toEqual(['demo/demo', 'byo/llama3.2:3b']);
  });

  it('falls back to the first available model when the remembered selection is unavailable', async () => {
    localStorage.setItem('crisp:model', 'anthropic/claude-haiku-4-5');
    mocks.getModels.mockResolvedValue([
      model('anthropic/claude-haiku-4-5', { available: false, unavailableReason: 'no key' }),
      model('demo/demo', { provider: 'Demo' }),
    ]);
    const store = useAppStore();
    await store.loadModels();
    expect(store.selectedModelId).toBe('demo/demo');
  });
});

describe('BYOK: withUserKey / setApiKey / userApiKeyFor (ADR-0006)', () => {
  it('a stored user key lights up a model the server has no key for', async () => {
    localStorage.setItem('crisp:api-keys', JSON.stringify({ anthropic: 'sk-ant-1' }));
    mocks.getModels.mockResolvedValue([
      model('anthropic/claude-haiku-4-5', { available: false, unavailableReason: 'no key' }),
    ]);
    const store = useAppStore();
    await store.loadModels();
    expect(store.models[0]).toMatchObject({ available: true });
    expect(store.models[0]!.unavailableReason).toBeUndefined();
  });

  it('leaves models alone when they are already available or the user has no key', () => {
    const store = useAppStore();
    const available = model('anthropic/claude-haiku-4-5');
    expect(store.withUserKey(available)).toBe(available);
    const unavailable = model('openai/gpt-4o-mini', { available: false, unavailableReason: 'no key' });
    expect(store.withUserKey(unavailable)).toBe(unavailable);
  });

  it('never lights up demo or byo models (they take no key)', () => {
    localStorage.setItem('crisp:api-keys', JSON.stringify({ anthropic: 'sk-ant-1' }));
    setActivePinia(createPinia());
    const store = useAppStore();
    const demo = model('demo/demo', { available: false });
    expect(store.withUserKey(demo)).toBe(demo);
  });

  it('setApiKey trims, persists, and refreshes model availability', async () => {
    const store = useAppStore();
    store.setApiKey('anthropic', '  sk-ant-9  ');
    expect(store.apiKeys.anthropic).toBe('sk-ant-9');
    expect(localStorage.getItem('crisp:api-keys')).toBe(JSON.stringify({ anthropic: 'sk-ant-9' }));
    expect(mocks.getModels).toHaveBeenCalled(); // loadModels re-ran
  });

  it('setApiKey with blank input deletes the key and the storage entry', () => {
    const store = useAppStore();
    store.setApiKey('anthropic', 'sk-ant-9');
    store.setApiKey('anthropic', '   ');
    expect(store.apiKeys.anthropic).toBeUndefined();
    expect(localStorage.getItem('crisp:api-keys')).toBeNull();
  });

  it('userApiKeyFor resolves through the model id and is null for keyless providers', () => {
    const store = useAppStore();
    store.setApiKey('openrouter', 'sk-or-1');
    expect(store.userApiKeyFor('openrouter/meta-llama/llama-3.1-8b-instruct')).toBe('sk-or-1');
    expect(store.userApiKeyFor('anthropic/claude-haiku-4-5')).toBeNull();
    expect(store.userApiKeyFor('demo/demo')).toBeNull();
    expect(store.userApiKeyFor('byo/llama3.2:3b')).toBeNull();
  });
});

describe('layout and navigation', () => {
  it('clamps and persists the sidebar width', () => {
    const store = useAppStore();
    store.setSidebarWidth(10_000);
    expect(store.sidebarWidth).toBe(SIDEBAR_MAX);
    store.setSidebarWidth(10);
    expect(store.sidebarWidth).toBe(SIDEBAR_MIN);
    expect(localStorage.getItem('crisp:sidebar-width')).toBe(String(SIDEBAR_MIN));
  });

  it('going narrow closes the sidebar; going wide again does not force it open', () => {
    const store = useAppStore();
    store.setNarrow(true);
    expect(store.sidebarOpen).toBe(false);
    store.setNarrow(false);
    expect(store.sidebarOpen).toBe(false);
  });

  it('opening a conversation on a narrow screen closes the sidebar and persists the id', () => {
    stubMatchMedia({ narrow: true });
    const store = useAppStore();
    store.sidebarOpen = true;
    store.openConversation('conv-7');
    expect(store.activeConversationId).toBe('conv-7');
    expect(localStorage.getItem('crisp:active-conversation')).toBe('conv-7');
    expect(store.sidebarOpen).toBe(false);
  });

  it('newConversation mints a fresh id and marks it fresh until the server lists it', async () => {
    const store = useAppStore();
    store.newConversation();
    const id = store.activeConversationId;
    expect(store.freshConversationIds.has(id)).toBe(true);
    mocks.listConversations.mockResolvedValue([
      { id, title: 'Hello', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ] as never);
    await store.loadConversations();
    expect(store.freshConversationIds.has(id)).toBe(false);
  });

  it('removeConversation deletes remotely and moves off the active conversation', async () => {
    const store = useAppStore();
    const doomed = store.activeConversationId;
    store.conversations = [{ id: doomed, title: 'x', createdAt: '', updatedAt: '' }] as never;
    await store.removeConversation(doomed);
    expect(mocks.deleteConversation).toHaveBeenCalledWith(doomed);
    expect(store.conversations).toEqual([]);
    expect(store.activeConversationId).not.toBe(doomed);
  });

  it('selectModel persists the choice for the next visit', () => {
    const store = useAppStore();
    store.selectModel('anthropic/claude-haiku-4-5');
    expect(localStorage.getItem('crisp:model')).toBe('anthropic/claude-haiku-4-5');
  });
});

describe('theme', () => {
  it('follows the system until toggled, then persists the explicit choice', () => {
    stubMatchMedia({ darkSystem: true });
    const store = useAppStore();
    expect(store.effectiveTheme).toBe('dark');
    store.toggleTheme();
    expect(store.theme).toBe('light');
    expect(localStorage.getItem('crisp:theme')).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
