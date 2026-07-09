import type { Feedback } from './contracts';

/**
 * The port for persisting Feedback onto the Message a Run produced. The
 * adapter that stores Conversations satisfies it too — this slice only
 * declares the sliver it needs.
 */
export interface FeedbackStore {
  /**
   * Sets (or, with null, retracts) the Feedback on the Message a Run
   * produced, if that Run belongs to one of the owner's Conversations.
   * Returns false when no such Message exists.
   */
  setFeedback(runId: string, feedback: Feedback | null, owner: string): Promise<boolean>;
}

/**
 * The port for mirroring Feedback to observability (ADR-0005). Implementations
 * are best-effort: they must swallow their own failures.
 */
export interface FeedbackSink {
  record(runId: string, feedback: Feedback | null): Promise<void>;
}
