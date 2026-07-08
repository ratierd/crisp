import type { ChatMessage, StreamChunk, TextAdapter, TokenUsage } from './types';

export interface ChatOptions {
  adapter: TextAdapter;
  messages: ChatMessage[];
  systemPrompts?: string[];
  threadId?: string;
  runId?: string;
  /** Aborting this controller stops the provider call mid-stream. */
  abortController?: AbortController;
}

const generateId = (): string => crypto.randomUUID();

/** A stop is the consumer's doing — it must propagate, not become RUN_ERROR. */
const isAbort = (error: unknown, signal?: AbortSignal): boolean =>
  signal?.aborted === true || (error instanceof DOMException && error.name === 'AbortError');

/**
 * Runs one text generation against a provider adapter and streams it as
 * AG-UI events (the app's lingua franca, ADR-0002):
 *
 *   RUN_STARTED → TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* →
 *   TEXT_MESSAGE_END → RUN_FINISHED {usage?}
 *
 * TEXT_MESSAGE_START is held back until the first token, so a run that fails
 * before producing text never announces an empty message. Provider failures
 * become a terminal RUN_ERROR event carrying the raw provider message —
 * classification into the app's taxonomy stays the caller's job. An abort
 * (the passed abortController) rethrows instead, so callers can tell a user
 * stop from a provider failure.
 */
export async function* chat(options: ChatOptions): AsyncGenerator<StreamChunk> {
  const { adapter } = options;
  const runId = options.runId ?? `run-${generateId()}`;
  const threadId = options.threadId ?? `thread-${generateId()}`;
  const signal = options.abortController?.signal;
  const model = adapter.model;

  yield { type: 'RUN_STARTED', runId, threadId, model, timestamp: Date.now() };

  const messageId = `${runId}-m0`;
  let started = false;
  let finishReason: string | undefined;
  let usage: TokenUsage | undefined;

  try {
    const stream = adapter.chatStream({
      messages: options.messages,
      ...(options.systemPrompts && options.systemPrompts.length > 0 ? { systemPrompts: options.systemPrompts } : {}),
      ...(signal ? { signal } : {}),
    });
    for await (const event of stream) {
      if (event.type === 'text-delta') {
        if (event.delta.length === 0) continue;
        if (!started) {
          started = true;
          yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', model, timestamp: Date.now() };
        }
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta: event.delta, model, timestamp: Date.now() };
      } else {
        if (event.finishReason !== undefined) finishReason = event.finishReason;
        if (event.usage !== undefined) usage = event.usage;
      }
    }
  } catch (error) {
    if (isAbort(error, signal)) throw error;
    const code = (error as { code?: unknown } | null)?.code;
    yield {
      type: 'RUN_ERROR',
      runId,
      threadId,
      model,
      message: error instanceof Error ? error.message : String(error),
      ...(typeof code === 'string' ? { code } : {}),
      timestamp: Date.now(),
    };
    return;
  }

  if (started) yield { type: 'TEXT_MESSAGE_END', messageId, model, timestamp: Date.now() };
  yield {
    type: 'RUN_FINISHED',
    runId,
    threadId,
    model,
    finishReason: finishReason ?? 'stop',
    ...(usage ? { usage } : {}),
    timestamp: Date.now(),
  };
}
