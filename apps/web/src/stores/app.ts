import { defineStore } from 'pinia';
import type { Conversation, KeyedProvider, Model } from '@crisp/contracts';
import { keyedProviderOf } from '@crisp/contracts';
import * as api from '../lib/api';
import { discoverByoModels } from '../lib/byo';
import { loadApiKeys, saveApiKeys, type ApiKeys } from '../lib/keys';

type Theme = 'light' | 'dark';

const THEME_KEY = 'crisp:theme';
const MODEL_KEY = 'crisp:model';
const ACTIVE_KEY = 'crisp:active-conversation';
const SIDEBAR_WIDTH_KEY = 'crisp:sidebar-width';

export const SIDEBAR_MIN = 250;
export const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 264;

const clampSidebarWidth = (width: number): number =>
  Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(width)));

const initialSidebarWidth = (): number => {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0 ? clampSidebarWidth(stored) : SIDEBAR_DEFAULT;
};

const systemTheme = (): Theme =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

/** The last open conversation survives reloads — mid-run resume depends on it. */
const initialConversation = (): { id: string; fresh: boolean } => {
  const stored = localStorage.getItem(ACTIVE_KEY);
  if (stored) return { id: stored, fresh: false };
  const id = crypto.randomUUID();
  localStorage.setItem(ACTIVE_KEY, id);
  return { id, fresh: true };
};

/**
 * App state only (conversation list, models, theme, layout). Live chat
 * state stays inside useChat per conversation.
 */
export const useAppStore = defineStore('app', {
  state: () => {
    const initial = initialConversation();
    return {
      models: [] as Model[],
      conversations: [] as Conversation[],
      activeConversationId: initial.id,
      /** Ids minted client-side — they don't exist server-side until the first message. */
      freshConversationIds: new Set<string>(initial.fresh ? [initial.id] : []),
      selectedModelId: localStorage.getItem(MODEL_KEY) ?? 'demo/demo',
      /** True once the browser has found the user's own Ollama (ADR-0004). */
      byoConnected: false,
      /** The visitor's own provider keys (BYOK, ADR-0006) — this browser only. */
      apiKeys: loadApiKeys() as ApiKeys,
      theme: (localStorage.getItem(THEME_KEY) as Theme | null) ?? null,
      sidebarOpen: true,
      sidebarWidth: initialSidebarWidth(),
      narrow: false,
    };
  },

  getters: {
    selectedModel(state): Model | null {
      return state.models.find((m) => m.id === state.selectedModelId) ?? null;
    },
    /** The user key the given Model runs on, if they brought one. */
    userApiKeyFor(state): (modelId: string) => string | null {
      return (modelId) => {
        const provider = keyedProviderOf(modelId);
        return (provider && state.apiKeys[provider]) || null;
      };
    },
    activeConversation(state): Conversation | null {
      return state.conversations.find((c) => c.id === state.activeConversationId) ?? null;
    },
    effectiveTheme(state): Theme {
      return state.theme ?? systemTheme();
    },
  },

  actions: {
    async loadModels() {
      // server registry (demo + remote) + the browser's own view of the user's Ollama
      const [server, byo] = await Promise.all([api.getModels(), discoverByoModels()]);
      this.byoConnected = byo.length > 0;
      // a user key lights up models the server has no key for (BYOK)
      this.models = [...server.map((m) => this.withUserKey(m)), ...byo];
      const selected = this.models.find((m) => m.id === this.selectedModelId);
      if (!selected?.available) {
        this.selectedModelId = this.models.find((m) => m.available)?.id ?? 'demo/demo';
      }
    },

    withUserKey(model: Model): Model {
      if (model.available || !this.userApiKeyFor(model.id)) return model;
      const { unavailableReason: _, ...rest } = model;
      return { ...rest, available: true };
    },

    setApiKey(provider: KeyedProvider, key: string) {
      const trimmed = key.trim();
      if (trimmed.length > 0) this.apiKeys[provider] = trimmed;
      else delete this.apiKeys[provider];
      saveApiKeys(this.apiKeys);
      void this.loadModels(); // availability may have just changed
    },

    async loadConversations() {
      this.conversations = await api.listConversations();
      // anything the server knows about is no longer fresh
      for (const conversation of this.conversations) {
        this.freshConversationIds.delete(conversation.id);
      }
    },

    selectModel(id: string) {
      this.selectedModelId = id;
      localStorage.setItem(MODEL_KEY, id);
    },

    openConversation(id: string) {
      this.activeConversationId = id;
      localStorage.setItem(ACTIVE_KEY, id);
      if (this.narrow) this.sidebarOpen = false;
    },

    newConversation() {
      this.activeConversationId = crypto.randomUUID();
      this.freshConversationIds.add(this.activeConversationId);
      localStorage.setItem(ACTIVE_KEY, this.activeConversationId);
      if (this.narrow) this.sidebarOpen = false;
    },

    async removeConversation(id: string) {
      await api.deleteConversation(id);
      this.conversations = this.conversations.filter((c) => c.id !== id);
      if (this.activeConversationId === id) this.newConversation();
    },

    toggleTheme() {
      this.theme = this.effectiveTheme === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_KEY, this.theme);
      document.documentElement.dataset.theme = this.theme;
    },

    applyTheme() {
      if (this.theme) document.documentElement.dataset.theme = this.theme;
    },

    setSidebarWidth(width: number) {
      this.sidebarWidth = clampSidebarWidth(width);
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(this.sidebarWidth));
    },

    setNarrow(narrow: boolean) {
      if (narrow && !this.narrow) this.sidebarOpen = false;
      this.narrow = narrow;
    },
  },
});
