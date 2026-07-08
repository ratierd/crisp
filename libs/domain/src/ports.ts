import type { Conversation, ConversationWithMessages, Message, Model } from '@crisp/contracts';

/**
 * An AG-UI streaming event. Events cross the hexagon untranslated (ADR-0002);
 * the domain only inspects the discriminant and a few well-known fields.
 */
export interface RunEvent {
  type: string;
  [key: string]: unknown;
}

/** Chat-shaped input for a Run, already flattened for the gateway. */
export interface GatewayMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StartRunOptions {
  model: Model;
  messages: GatewayMessage[];
  runId: string;
  threadId: string;
  signal?: AbortSignal;
}

/**
 * The port through which the domain starts a Run against any Model,
 * regardless of Provenance. Implementations must emit RUN_ERROR events
 * (code = RunErrorKind) instead of throwing for provider failures.
 */
export interface ModelGateway {
  startRun(options: StartRunOptions): AsyncIterable<RunEvent>;
}

/** The port for durable Conversation storage. */
export interface ConversationRepository {
  create(conversation: Conversation): Promise<void>;
  get(id: string): Promise<ConversationWithMessages | null>;
  list(): Promise<Conversation[]>;
  rename(id: string, title: string): Promise<void>;
  delete(id: string): Promise<void>;
  appendMessage(conversationId: string, message: Message): Promise<void>;
  /** Regenerate support: drops every Message after the given one. */
  deleteMessagesAfter(conversationId: string, messageId: string): Promise<void>;
}

/**
 * The port for buffering and fanning out the live event stream of a Run,
 * enabling mid-stream resume.
 */
export interface RunStreamStore {
  append(runId: string, event: RunEvent): Promise<void>;
  /** Seals the stream; replay() iterators complete once they catch up. */
  markFinished(runId: string): Promise<void>;
  /** Replays buffered events from the start, then tails live until finished. */
  replay(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent>;
  setActiveRun(conversationId: string, runId: string | null): Promise<void>;
  activeRun(conversationId: string): Promise<string | null>;
}
