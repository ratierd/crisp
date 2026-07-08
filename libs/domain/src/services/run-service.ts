import type { Message, Model, RunErrorKind } from '@crisp/contracts';
import type { ConversationRepository, GatewayMessage, ModelGateway, RunEvent, RunStreamStore } from '../ports';

export interface RunServiceDeps {
  gateway: ModelGateway;
  conversations: ConversationRepository;
  runStreams: RunStreamStore;
  now?: () => number;
  newId?: () => string;
}

export interface ExecuteRunInput {
  conversationId: string;
  runId: string;
  model: Model;
  history: GatewayMessage[];
  /** Persisted before the Run starts; absent when regenerating. */
  userMessage?: Message;
  signal?: AbortSignal;
}

const textDelta = (event: RunEvent): string | null =>
  event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string' ? event.delta : null;

/**
 * Orchestrates one Run: streams gateway events to the caller while teeing
 * them into the RunStreamStore, then persists the outcome. The assistant
 * Message is kept even when the Run stops early, as long as text arrived.
 */
export class RunService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: RunServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  async *execute(input: ExecuteRunInput): AsyncIterable<RunEvent> {
    const { gateway, conversations, runStreams } = this.deps;
    const { runId } = input;
    const startedAt = this.now();

    if (input.userMessage) {
      await conversations.appendMessage(input.conversationId, input.userMessage);
    }
    await runStreams.setActiveRun(input.conversationId, runId);

    let text = '';
    let firstTokenAt: number | null = null;
    let deltaCount = 0;
    let failed = false;

    const finalize = async (stoppedEarly: boolean) => {
      if (text.length > 0 && !failed) {
        const finishedAt = this.now();
        const streamMs = finishedAt - (firstTokenAt ?? startedAt);
        const assistant: Message = {
          id: this.newId(),
          role: 'assistant',
          parts: [{ type: 'text', content: text }],
          createdAt: new Date(finishedAt).toISOString(),
          modelId: input.model.id,
          stats: {
            ttftMs: (firstTokenAt ?? finishedAt) - startedAt,
            tokensPerSec: streamMs > 0 ? Math.round((deltaCount / streamMs) * 1000) : deltaCount,
          },
          ...(stoppedEarly ? { stoppedEarly: true } : {}),
        };
        await conversations.appendMessage(input.conversationId, assistant);
      }
      await runStreams.setActiveRun(input.conversationId, null);
      await runStreams.markFinished(runId);
    };

    try {
      const events = gateway.startRun({
        model: input.model,
        messages: input.history,
        runId,
        threadId: input.conversationId,
        signal: input.signal,
      });
      for await (const event of events) {
        const delta = textDelta(event);
        if (delta !== null) {
          if (firstTokenAt === null) firstTokenAt = this.now();
          text += delta;
          deltaCount += 1;
        }
        if (event.type === 'RUN_ERROR') failed = true;
        await runStreams.append(runId, event);
        yield event;
        if (failed) break;
      }
    } catch (error) {
      if (input.signal?.aborted) {
        await finalize(true);
        return;
      }
      // Gateways emit RUN_ERROR for provider failures; anything that still
      // throws is genuinely unexpected.
      const runError = this.runErrorEvent(runId, input.model, 'unknown', error);
      failed = true;
      await runStreams.append(runId, runError);
      yield runError;
      await finalize(false);
      return;
    }

    await finalize(input.signal?.aborted ?? false);
  }

  private runErrorEvent(runId: string, model: Model, kind: RunErrorKind, error: unknown): RunEvent {
    return {
      type: 'RUN_ERROR',
      runId,
      code: kind,
      message: error instanceof Error ? error.message : String(error),
      provider: model.provider,
      timestamp: this.now(),
    };
  }
}
