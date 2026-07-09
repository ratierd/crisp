import type { Message } from '@crisp/conversations/contracts';
import type { RunEvent } from './contracts';
import type { MessageStore, ModelGateway, RunStreamStore, StartRunOptions } from './ports';

/** In-memory MessageStore for tests of this slice alone. */
export class FakeMessageStore implements MessageStore {
  readonly messages = new Map<string, Message[]>();

  async appendMessage(conversationId: string, message: Message): Promise<void> {
    const list = this.messages.get(conversationId) ?? [];
    list.push(message);
    this.messages.set(conversationId, list);
  }

  async deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
    const list = this.messages.get(conversationId) ?? [];
    const index = list.findIndex((m) => m.id === messageId);
    if (index >= 0) this.messages.set(conversationId, list.slice(0, index + 1));
  }
}

/** In-memory RunStreamStore for tests. Live tailing resolves via polling. */
export class FakeRunStreamStore implements RunStreamStore {
  readonly events = new Map<string, RunEvent[]>();
  readonly finished = new Set<string>();
  private readonly active = new Map<string, string>();

  async append(runId: string, event: RunEvent): Promise<void> {
    const list = this.events.get(runId) ?? [];
    list.push(event);
    this.events.set(runId, list);
  }

  async markFinished(runId: string): Promise<void> {
    this.finished.add(runId);
  }

  async *replay(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent> {
    let cursor = 0;
    let idlePolls = 0;
    while (!signal?.aborted && idlePolls < 1000) {
      const list = this.events.get(runId) ?? [];
      if (cursor < list.length) idlePolls = 0;
      while (cursor < list.length) yield list[cursor++]!;
      if (this.finished.has(runId)) return;
      idlePolls += 1;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  async claimActiveRun(conversationId: string, runId: string): Promise<boolean> {
    if (this.active.has(conversationId)) return false;
    this.active.set(conversationId, runId);
    return true;
  }

  async releaseActiveRun(conversationId: string, runId: string): Promise<void> {
    if (this.active.get(conversationId) === runId) this.active.delete(conversationId);
  }

  async activeRun(conversationId: string): Promise<string | null> {
    return this.active.get(conversationId) ?? null;
  }
}

export interface FakeGatewayOptions {
  /** Events to emit per startRun call. */
  events?: RunEvent[];
  /** Throw after emitting this many events. */
  throwAfter?: number;
  error?: Error;
  /** Delay between events, for abort tests. */
  delayMs?: number;
}

/** ModelGateway fake: emits a scripted event sequence. */
export class FakeModelGateway implements ModelGateway {
  readonly calls: StartRunOptions[] = [];

  constructor(private readonly options: FakeGatewayOptions = {}) {}

  async *startRun(options: StartRunOptions): AsyncIterable<RunEvent> {
    this.calls.push(options);
    const events = this.options.events ?? defaultRunEvents(options.runId, 'Hello world');
    let emitted = 0;
    for (const event of events) {
      if (this.options.throwAfter !== undefined && emitted >= this.options.throwAfter) {
        throw this.options.error ?? new Error('gateway exploded');
      }
      if (this.options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
      }
      if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      yield event;
      emitted += 1;
    }
  }
}

/** A well-formed AG-UI event sequence streaming `text` word by word. */
export const defaultRunEvents = (runId: string, text: string): RunEvent[] => {
  const messageId = `${runId}-msg`;
  const words = text.split(/(?<= )/);
  return [
    { type: 'RUN_STARTED', runId, threadId: 't' },
    { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
    ...words.map((delta) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta })),
    { type: 'TEXT_MESSAGE_END', messageId },
    { type: 'RUN_FINISHED', runId, finishReason: 'stop' },
  ];
};
