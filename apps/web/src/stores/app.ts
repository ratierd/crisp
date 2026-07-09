import { defineStore } from 'pinia';
import type { Conversation } from '@crisp/conversations/contracts';
import type { KeyedProvider, Model } from '@crisp/models/contracts';
import { keyedProviderOf } from '@crisp/models/contracts';
import * as api from '../lib/api';
import { discoverByoModels, shouldAutoDiscover } from '../lib/byo';
import { loadApiKeys, saveApiKeys, type ApiKeys } from '../lib/keys';
import { loadTourMode, saveTourMode } from '../lib/tour';

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
    // Synchronous narrow detection: the ResizeObserver in App.vue only fires
    // after mount, so deriving this at store creation keeps the first paint
    // from rendering a sidebar that immediately collapses (CLS). Must match
    // the observer's `width < 780` breakpoint.
    const narrow = window.matchMedia('(max-width: 779px)').matches;
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
      /** Tour Mode (ADR-0009): new Conversations open with the Tour Context. */
      tourMode: loadTourMode(),
      theme: (localStorage.getItem(THEME_KEY) as Theme | null) ?? null,
      sidebarOpen: !narrow,
      sidebarWidth: initialSidebarWidth(),
      narrow,
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
    /**
     * `probeByo` forces the browser-side Ollama probe (the model picker does
     * this on open); otherwise it only runs where it can plausibly succeed,
     * so deployed visitors without Ollama never see the CORS error.
     */
    async loadModels(probeByo = false) {
      // server registry (demo + remote) + the browser's own view of the user's Ollama
      const [server, byo] = await Promise.all([
        api.getModels(),
        probeByo || shouldAutoDiscover() ? discoverByoModels() : Promise.resolve([]),
      ]);
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

    /**
     * A non-fresh Conversation id that 404s on load is dead — the row is
     * invisible to this visitor (e.g. it predates owner scoping), so every
     * send into it can only 409. Roll to a fresh Conversation instead of
     * keeping it as the send target; guarded so a slow load can't clobber
     * a conversation the user already switched to.
     */
    recoverDeadConversation(id: string) {
      if (this.activeConversationId === id) this.newConversation();
    },

    async removeConversation(id: string) {
      await api.deleteConversation(id);
      this.conversations = this.conversations.filter((c) => c.id !== id);
      if (this.activeConversationId === id) this.newConversation();
    },

    setTourMode(on: boolean) {
      this.tourMode = on;
      saveTourMode(on);
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
