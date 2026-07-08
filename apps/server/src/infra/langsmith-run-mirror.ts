import type { Client } from 'langsmith';
import type { MirroredRun, RunMirror } from '@crisp/domain';
import { openTrace, traceOutputs } from './langsmith-trace';

/**
 * Reconstructs the LangSmith trace of a BYO-Ollama Run post-hoc (ADR-0004):
 * the generation happened in the user's browser, so the trace is written in
 * one shot at persist time, with the client-reported start/end times. Same
 * shape and same run id scheme as live server traces — Feedback and the
 * Threads view can't tell the difference.
 */
export class LangsmithRunMirror implements RunMirror {
  constructor(
    private readonly client: Client,
    private readonly projectName?: string,
  ) {}

  async record(run: MirroredRun): Promise<void> {
    try {
      const trace = openTrace({
        client: this.client,
        projectName: this.projectName,
        model: run.model,
        runId: run.runId,
        threadId: run.conversationId,
        messages: run.messages,
        startTime: run.startedAt,
      });
      await trace.postRun();
      await trace.end(traceOutputs(run.assistantText, run.usage), run.error, run.finishedAt, {
        outcome: run.outcome,
      });
      await trace.patchRun();
    } catch (error) {
      console.warn('[langsmith] BYO run mirror failed:', error);
    }
  }
}
