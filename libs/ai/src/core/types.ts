/**
 * @crisp/ai core types. The lib is Crisp's in-house AG-UI client: provider
 * adapters normalized into one event envelope, an SSE transport, and the
 * Vue chat composable — exactly the surface Crisp consumes.
 */

/**
 * An AG-UI streaming event, read loosely (same stance as the domain's
 * RunEvent, ADR-0002): consumers inspect `type` and a few well-known fields.
 */
export interface StreamChunk {
  type: string;
  [key: string]: unknown;
}

/** Token accounting as the app understands it (RUN_FINISHED `usage`). */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Conversation turns for a provider call; system prompts travel separately. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AdapterRequest {
  messages: ChatMessage[];
  systemPrompts?: string[];
  signal?: AbortSignal;
}

/**
 * What a provider adapter yields: bare text deltas plus one terminal `finish`
 * carrying whatever usage/stop-reason the provider reported. The AG-UI
 * envelope (RUN_STARTED, TEXT_MESSAGE_*, RUN_FINISHED) is `chat()`'s job, so
 * every provider streams identically to the rest of the app.
 */
export type AdapterEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'finish'; finishReason?: string; usage?: TokenUsage };

/** A provider adapter: normalizes one provider's stream into AdapterEvents. */
export interface TextAdapter {
  /** Provider name, for diagnostics. */
  readonly name: string;
  /** Model name as the provider knows it. */
  readonly model: string;
  /** Streams one completion. Throws on provider failure; `chat()` converts. */
  chatStream(request: AdapterRequest): AsyncIterable<AdapterEvent>;
}
