import type { Client } from 'langsmith';
import type { Feedback } from '@crisp/feedback/contracts';
import type { FeedbackSink } from '@crisp/feedback';

const KEY = 'user-rating';

/**
 * Mirrors Feedback to LangSmith against the Run's own id (ADR-0005). The
 * feedback id is the runId too, which makes the operation idempotent:
 * latest state wins, retraction deletes. Best-effort by contract — the
 * SQLite copy on the Message is the source of UI truth.
 */
export class LangsmithFeedbackSink implements FeedbackSink {
  constructor(private readonly client: Client) {}

  async record(runId: string, feedback: Feedback | null): Promise<void> {
    try {
      if (!feedback) {
        await this.client.deleteFeedback(runId);
        return;
      }
      const score = feedback.score === 'up' ? 1 : 0;
      try {
        await this.client.createFeedback(runId, KEY, {
          score,
          comment: feedback.comment,
          feedbackId: runId,
        });
      } catch {
        // the deterministic id already exists — this is a vote change
        await this.client.updateFeedback(runId, { score, comment: feedback.comment ?? null });
      }
    } catch (error) {
      console.warn('[langsmith] feedback mirror failed:', error);
    }
  }
}
