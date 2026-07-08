import type { Conversation, ConversationWithMessages, Feedback, Message, Model } from '@crisp/contracts';

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
  /**
   * Sets (or, with null, retracts) the Feedback on the Message a Run
   * produced. Returns false when no Message carries that runId.
   */
  setFeedback(runId: string, feedback: Feedback | null): Promise<boolean>;
}

/**
 * The port for mirroring Feedback to observability (ADR-0005). Implementations
 * are best-effort: they must swallow their own failures.
 */
export interface FeedbackSink {
  record(runId: string, feedback: Feedback | null): Promise<void>;
}

/** A finished Run executed outside the server (BYO), as the client reports it. */
export interface MirroredRun {
  runId: string;
  conversationId: string;
  model: Model;
  messages: GatewayMessage[];
  assistantText: string;
  outcome: 'completed' | 'stopped' | 'failed';
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  startedAt: number;
  finishedAt: number;
  error?: string;
}

/**
 * The port for mirroring externally-executed Runs to observability
 * (ADR-0004/0004). Best-effort, like FeedbackSink.
 */
export interface RunMirror {
  record(run: MirroredRun): Promise<void>;
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
