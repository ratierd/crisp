import type { RunTree } from 'langsmith/run_trees';
import type { Client } from 'langsmith';
import type { ModelGateway, RunEvent, StartRunOptions } from '@crisp/runs';
import { openTrace, traceOutputs, type TraceUsage } from './langsmith-trace';

interface TraceResult {
  text: string;
  usage: TraceUsage | undefined;
  errorMessage: string | undefined;
  outcome: 'completed' | 'stopped' | 'failed';
}

/**
 * ModelGateway decorator that mirrors every Run — remote, local, demo,
 * stopped, failed — into LangSmith as one flat `llm` run whose LangSmith id
 * IS the Run's id, so Feedback needs no mapping table (ADR-0005). The
 * Conversation id travels as `thread_id` metadata (LangSmith Threads view).
 * Tracing is best-effort: a LangSmith hiccup logs a warning and never
 * disturbs the stream.
 */
export class LangsmithTracingGateway implements ModelGateway {
  constructor(
    private readonly inner: ModelGateway,
    private readonly client: Client,
    private readonly projectName?: string,
  ) {}

  async *startRun(options: StartRunOptions): AsyncIterable<RunEvent> {
    const trace = await this.begin(options);
    let text = '';
    let usage: TraceUsage | undefined;
    let errorMessage: string | undefined;
    let sawFinish = false;

    try {
      for await (const event of this.inner.startRun(options)) {
        if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string')
          text += event.delta;
        if (event.type === 'RUN_FINISHED' && event.usage && typeof event.usage === 'object') {
          usage = event.usage as TraceUsage;
        }
        if (event.type === 'RUN_FINISHED') sawFinish = true;
        if (event.type === 'RUN_ERROR') {
          errorMessage = typeof event.message === 'string' ? event.message : 'The run failed.';
        }
        yield event;
      }
    } catch (error) {
      if (!options.signal?.aborted) {
        errorMessage ??= error instanceof Error ? error.message : String(error);
      }
      throw error;
    } finally {
      // The consumer may stop reading mid-stream (RunService breaks after
      // RUN_ERROR; stop aborts the signal) — finally is the one place every
      // path funnels through, so the trace is always closed here.
      const outcome = errorMessage ? 'failed' : sawFinish ? 'completed' : 'stopped';
      await this.end(trace, { text, usage, errorMessage, outcome });
    }
  }

  private async begin(options: StartRunOptions): Promise<RunTree | null> {
    try {
      const trace = openTrace({
        client: this.client,
        projectName: this.projectName,
        model: options.model,
        runId: options.runId,
        threadId: options.threadId,
        messages: options.messages,
      });
      await trace.postRun();
      return trace;
    } catch (error) {
      console.warn('[langsmith] failed to open trace:', error);
      return null;
    }
  }

  private async end(trace: RunTree | null, result: TraceResult): Promise<void> {
    if (!trace) return;
    try {
      await trace.end(traceOutputs(result.text, result.usage), result.errorMessage, undefined, {
        outcome: result.outcome,
      });
      await trace.patchRun();
    } catch (error) {
      console.warn('[langsmith] failed to close trace:', error);
    }
  }
}
