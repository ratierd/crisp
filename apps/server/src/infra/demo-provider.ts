import type { RunEvent, StartRunOptions } from '@crisp/runs';
import { pickTourEntry } from './tour-script';

const ERROR_TRIGGER = /error:(provider_unavailable|auth_failed|rate_limited|unknown)/;

/** Tour answers for chat runs; the matching canned title for titling runs. */
const pickResponse = (lastUserText: string, systemText: string): string => {
  const entry = pickTourEntry(lastUserText);
  return /short title/i.test(systemText) ? entry.title : entry.answer;
};

/** Splits text into small chunks that feel like tokens when streamed. */
const tokenize = (text: string): string[] =>
  text.split(/(?<=\s)/).flatMap((w) => (w.length > 12 ? [w.slice(0, 8), w.slice(8)] : [w]));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DemoProviderOptions {
  /** Delay between chunks. Playwright/integration tests use 0. */
  delayMs?: number;
}

/**
 * The zero-key "Demo" provider: streams canned markdown as well-formed AG-UI
 * events. Messages containing `error:<kind>` trigger that error, so error
 * cards can be demonstrated (and tested) deterministically.
 */
export async function* demoRun(
  options: StartRunOptions,
  config: DemoProviderOptions = {},
): AsyncIterable<RunEvent> {
  const delayMs = config.delayMs ?? 18;
  const lastUser = [...options.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const systemText = options.messages.find((m) => m.role === 'system')?.content ?? '';
  const { runId, threadId } = options;

  yield { type: 'RUN_STARTED', runId, threadId, model: 'demo', timestamp: Date.now() };

  const errorMatch = ERROR_TRIGGER.exec(lastUser);
  if (errorMatch) {
    await sleep(delayMs * 4);
    yield {
      type: 'RUN_ERROR',
      runId,
      threadId,
      code: errorMatch[1],
      message: `Demo error requested via "${errorMatch[0]}".`,
      timestamp: Date.now(),
    };
    return;
  }

  const messageId = `${runId}-m0`;
  yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', timestamp: Date.now() };
  let completionTokens = 0;
  for (const delta of tokenize(pickResponse(lastUser, systemText))) {
    if (options.signal?.aborted) throw new DOMException('The run was stopped.', 'AbortError');
    if (delayMs > 0) await sleep(delayMs);
    completionTokens += 1;
    yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, timestamp: Date.now() };
  }
  yield { type: 'TEXT_MESSAGE_END', messageId, timestamp: Date.now() };
  // Fabricated-but-plausible usage (≈4 chars/token) so demo traces look like
  // real ones in observability tooling.
  const promptTokens = Math.ceil(
    options.messages.reduce((total, m) => total + m.content.length, 0) / 4,
  );
  yield {
    type: 'RUN_FINISHED',
    runId,
    threadId,
    finishReason: 'stop',
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    timestamp: Date.now(),
  };
}
