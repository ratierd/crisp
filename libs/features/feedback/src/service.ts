import type { Feedback } from './contracts';
import type { FeedbackSink, FeedbackStore } from './ports';

export interface FeedbackServiceDeps {
  store: FeedbackStore;
  /** Optional observability mirror (ADR-0005) — absent composes cleanly. */
  sink?: FeedbackSink | undefined;
}

/** Records the user's verdict on a Run, then mirrors it best-effort. */
export class FeedbackService {
  constructor(private readonly deps: FeedbackServiceDeps) {}

  /** Returns false when the Run has no Message the owner can see. */
  async set(runId: string, feedback: Feedback | null, owner: string): Promise<boolean> {
    const found = await this.deps.store.setFeedback(runId, feedback, owner);
    // mirror only what was actually recorded, and never block on it
    if (found && this.deps.sink) void this.deps.sink.record(runId, feedback);
    return found;
  }
}
