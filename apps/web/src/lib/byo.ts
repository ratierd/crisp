import { chat, readWireMessages, type StreamChunk } from '@crisp/ai';
import { createOllamaChat } from '@crisp/ai/ollama';
import { fetchServerSentEvents, type ConnectConnectionAdapter } from '@crisp/ai/client';
import type { Model } from '@crisp/models/contracts';
import type { ByoRunRequest } from '@crisp/runs/contracts';
import * as api from './api';

/**
 * BYO Ollama (ADR-0004): local models are always the browser's job — a
 * deployed server can never reach the user's localhost, so there is no
 * server-side Ollama path at all. Models with the `byo/` prefix are
 * discovered from and executed against the user's own Ollama daemon, straight
 * from the browser, emitting the same AG-UI events server runs do. Finished
 * runs are reported to the server for persistence and observability.
 *
 * The user opts in once: `OLLAMA_ORIGINS=<this origin>` on their daemon
 * (plus Chrome's local-network permission prompt on HTTPS deployments).
 * Localhost origins are covered by Ollama's defaults, so in local dev the
 * daemon needs no config.
 */

export const BYO_PREFIX = 'byo/';
export const OLLAMA_LOCAL_URL = 'http://localhost:11434';

/** Set once discovery ever succeeded in this browser; never cleared. */
const BYO_CONNECTED_KEY = 'crisp:byo-connected';

export const isByoModelId = (id: string): boolean => id.startsWith(BYO_PREFIX);

/**
 * Whether mount-time discovery should probe localhost:11434 at all. On a
 * deployed origin the probe is a guaranteed CORS error in the console for
 * everyone without Ollama, so we only auto-probe where it can plausibly
 * succeed: local dev, or a browser that has connected before. Opening the
 * model picker still probes unconditionally.
 */
export const shouldAutoDiscover = (): boolean => {
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
  return localStorage.getItem(BYO_CONNECTED_KEY) === '1';
};

/** The one-time daemon config that allows this origin. Shown in the picker. */
export const byoConnectCommand = (): string =>
  `OLLAMA_ORIGINS=${window.location.origin} ollama serve`;

interface OllamaTag {
  name: string;
}

/** Browser-side discovery of the user's own Ollama. Silent on any failure. */
export const discoverByoModels = async (): Promise<Model[]> => {
  try {
    const response = await fetch(`${OLLAMA_LOCAL_URL}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: OllamaTag[] };
    const models: Model[] = (body.models ?? []).map((tag) => ({
      id: `${BYO_PREFIX}${tag.name}`,
      displayName: tag.name,
      provider: 'Ollama (yours)',
      provenance: 'local',
      available: true,
    }));
    // remember success so future visits auto-probe again (see shouldAutoDiscover)
    if (models.length > 0) localStorage.setItem(BYO_CONNECTED_KEY, '1');
    return models;
  } catch {
    return [];
  }
};

// ---- the browser-side gateway ---------------------------------------------

/** AG-UI stream chunk, read loosely (same stance as the server's RunEvent). */
interface Chunk {
  type: string;
  [key: string]: unknown;
}

/**
 * Runs one generation against the user's Ollama, in the page. Yields the
 * same AG-UI events a server run would (ADR-0002 pays off: the transcript
 * can't tell where events come from), then reports the finished run to the
 * server — persistence happens *before* RUN_FINISHED is released so the
 * sidebar refresh that follows sees the conversation.
 */
async function* runByoModel(
  model: Model,
  wireMessages: unknown[],
  signal: AbortSignal | undefined,
  threadId: string,
): AsyncIterable<Chunk> {
  // client-minted UUID: it becomes the LangSmith run id and Feedback anchor
  const runId = crypto.randomUUID();
  // Same reading the server does (@crisp/ai wire codec) — the history run
  // here and the report persisted below can never diverge.
  const { history, trailingUserMessage, leadingSystemMessage } = readWireMessages(wireMessages);
  const userMessage = trailingUserMessage ?? undefined;
  const startedAt = Date.now();
  const startedPerf = performance.now();
  let firstTokenPerf = 0;
  let text = '';
  let tokenCount = 0;
  let usage: ByoRunRequest['usage'];
  let errorMessage: string | undefined;
  let reported = false;

  const report = async (outcome: ByoRunRequest['outcome']) => {
    if (reported) return;
    reported = true;
    const reportPerf = performance.now();
    const streamMs = firstTokenPerf > 0 ? reportPerf - firstTokenPerf : 0;
    await api.postByoRun(threadId, {
      runId,
      modelId: model.id,
      history,
      userMessage,
      // the Tour Context this run opened with (persisted if the report
      // creates the Conversation, ADR-0009)
      ...(leadingSystemMessage ? { systemMessage: leadingSystemMessage } : {}),
      assistantText: text,
      outcome,
      stats: {
        ttftMs: firstTokenPerf > 0 ? Math.round(firstTokenPerf - startedPerf) : 0,
        tokensPerSec: streamMs > 0 ? Math.round((tokenCount / streamMs) * 1000) : tokenCount,
        durationMs: Math.round(reportPerf - startedPerf),
      },
      usage,
      startedAt,
      finishedAt: Date.now(),
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  };

  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    // system prompts travel separately in @crisp/ai (same as the server gateway)
    const systemPrompts = history.filter((m) => m.role === 'system').map((m) => m.content);
    const chatMessages = history
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    const stream = chat({
      adapter: createOllamaChat(model.id.slice(BYO_PREFIX.length), OLLAMA_LOCAL_URL),
      messages: chatMessages,
      ...(systemPrompts.length > 0 ? { systemPrompts } : {}),
      threadId,
      runId,
      abortController,
    });
    for await (const chunk of stream as AsyncIterable<Chunk>) {
      if (chunk.type === 'TEXT_MESSAGE_CONTENT' && typeof chunk.delta === 'string') {
        if (firstTokenPerf === 0) firstTokenPerf = performance.now();
        text += chunk.delta;
        tokenCount += 1;
      }
      if (chunk.type === 'RUN_FINISHED') {
        if (chunk.usage && typeof chunk.usage === 'object')
          usage = chunk.usage as ByoRunRequest['usage'];
        await report('completed');
      }
      if (chunk.type === 'RUN_ERROR') {
        errorMessage = typeof chunk.message === 'string' ? chunk.message : 'The run failed.';
        yield { ...chunk, code: 'provider_unavailable', provider: 'your Ollama' };
        break;
      }
      yield chunk;
    }
  } catch (error) {
    if (!signal?.aborted) {
      errorMessage = error instanceof Error ? error.message : String(error);
      yield {
        type: 'RUN_ERROR',
        runId,
        threadId,
        message: errorMessage,
        code: 'provider_unavailable',
        provider: 'your Ollama',
        timestamp: Date.now(),
      };
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    // stop / error / consumer-break paths land here with the run unreported
    void report(errorMessage ? 'failed' : signal?.aborted ? 'stopped' : 'completed');
  }
}

/**
 * The app's one connection: BYO models run in the page, everything else
 * streams from the server. Selection is read per send, so switching models
 * mid-conversation routes each Run to the right place.
 */
export const crispConnection = (selectedModel: () => Model | null): ConnectConnectionAdapter => {
  const sse = fetchServerSentEvents('/api/chat');
  return {
    connect(messages, data, abortSignal, runContext) {
      const model = selectedModel();
      if (model && isByoModelId(model.id) && runContext) {
        return runByoModel(
          model,
          messages,
          abortSignal,
          runContext.threadId,
        ) as AsyncIterable<StreamChunk>;
      }
      return sse.connect(messages, data, abortSignal, runContext);
    },
  };
};
