import type { Message } from '@crisp/conversations/contracts';
import type { Model } from '@crisp/models/contracts';
import type { GatewayMessage, RunEvent } from './contracts';

export interface StartRunOptions {
  model: Model;
  messages: GatewayMessage[];
  runId: string;
  threadId: string;
  signal?: AbortSignal;
  /**
   * User-supplied provider key (BYOK, ADR-0006). Takes precedence over any
   * server-configured key, lives only as long as the Run, and must never be
   * persisted, logged, or forwarded to observability.
   */
  apiKey?: string;
}

/**
 * The port through which this slice starts a Run against any Model,
 * regardless of Provenance. Implementations must emit RUN_ERROR events
 * (code = RunErrorKind) instead of throwing for provider failures.
 */
export interface ModelGateway {
  startRun(options: StartRunOptions): AsyncIterable<RunEvent>;
}

/**
 * The port for writing a Run's outcome into a Conversation — this slice's
 * own view of Message persistence, sized to exactly what it does. The same
 * adapter that serves the conversations slice's ConversationRepository
 * satisfies it at the composition root.
 */
export interface MessageStore {
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
  /**
   * Atomically claims the Conversation for a Run. Returns false when another
   * Run already holds the claim — the caller must not start a second one.
   * Implementations must make check-and-set a single atomic step.
   */
  claimActiveRun(conversationId: string, runId: string): Promise<boolean>;
  /**
   * Releases the claim, but only if this Run still holds it — a Run that
   * outlived its claim must never evict a successor's.
   */
  releaseActiveRun(conversationId: string, runId: string): Promise<void>;
  activeRun(conversationId: string): Promise<string | null>;
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
 * (ADR-0004/0005). Best-effort, like the feedback slice's FeedbackSink.
 */
export interface RunMirror {
  record(run: MirroredRun): Promise<void>;
}
