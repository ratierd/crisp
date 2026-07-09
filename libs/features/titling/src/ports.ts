import type { Model } from '@crisp/models/contracts';
import type { GatewayMessage, RunEvent } from '@crisp/runs/contracts';

/** What a title Run needs — StartRunOptions minus the abort signal. */
export interface TitleRunOptions {
  model: Model;
  messages: GatewayMessage[];
  runId: string;
  threadId: string;
  /** The same BYOK key that ran the exchange also titles it (ADR-0006). */
  apiKey?: string;
}

/**
 * The port through which this slice runs a Model — exactly the surface a
 * title generation needs. The adapter that satisfies the runs slice's
 * ModelGateway satisfies this too (title Runs flow through the same
 * decorators, e.g. tracing).
 */
export interface TitleModel {
  startRun(options: TitleRunOptions): AsyncIterable<RunEvent>;
}

/**
 * The port for applying a generated title. The Conversation-storing adapter
 * satisfies it at the composition root — this slice never sees the rest of
 * that adapter's surface.
 */
export interface ConversationRenamer {
  rename(conversationId: string, title: string): Promise<void>;
}
