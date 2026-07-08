import type { Conversation, ConversationWithMessages, Message } from '@crisp/contracts';
import type { ConversationRepository, ModelGateway, RunEvent, RunStreamStore, StartRunOptions } from '../ports';

/** In-memory ConversationRepository for tests. */
export class FakeConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();

  async create(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
  }

  async get(id: string): Promise<ConversationWithMessages | null> {
    const conversation = this.conversations.get(id);
    if (!conversation) return null;
    return { ...conversation, messages: this.messages.get(id) ?? [], activeRunId: null };
  }

  async list(): Promise<Conversation[]> {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async rename(id: string, title: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation) this.conversations.set(id, { ...conversation, title });
  }

  async delete(id: string): Promise<void> {
    this.conversations.delete(id);
    this.messages.delete(id);
  }

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

  async setActiveRun(conversationId: string, runId: string | null): Promise<void> {
    if (runId === null) this.active.delete(conversationId);
    else this.active.set(conversationId, runId);
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
