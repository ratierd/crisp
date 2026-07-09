import type { Conversation, ConversationWithMessages, Feedback, Message } from '@crisp/contracts';
import type {
  ConversationRepository,
  ModelGateway,
  RunEvent,
  RunStreamStore,
  StartRunOptions,
} from '../ports';

/** In-memory ConversationRepository for tests. */
export class FakeConversationRepository implements ConversationRepository {
  readonly conversations = new Map<string, Conversation>();
  readonly messages = new Map<string, Message[]>();
  readonly owners = new Map<string, string>();

  async create(conversation: Conversation, owner: string): Promise<void> {
    // Same contract as the SQLite PRIMARY KEY: an id can be created once,
    // whoever owns it — routes turn this into a 409.
    if (this.conversations.has(conversation.id)) {
      throw new Error(`conversation ${conversation.id} already exists`);
    }
    this.conversations.set(conversation.id, conversation);
    this.messages.set(conversation.id, []);
    this.owners.set(conversation.id, owner);
  }

  async get(id: string, owner: string): Promise<ConversationWithMessages | null> {
    const conversation = this.conversations.get(id);
    if (!conversation || this.owners.get(id) !== owner) return null;
    return { ...conversation, messages: this.messages.get(id) ?? [], activeRunId: null };
  }

  async list(owner: string): Promise<Conversation[]> {
    return [...this.conversations.values()]
      .filter((c) => this.owners.get(c.id) === owner)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async rename(id: string, title: string): Promise<void> {
    const conversation = this.conversations.get(id);
    if (conversation) this.conversations.set(id, { ...conversation, title });
  }

  async delete(id: string, owner: string): Promise<void> {
    if (this.owners.get(id) !== owner) return;
    this.conversations.delete(id);
    this.messages.delete(id);
    this.owners.delete(id);
  }

  async appendMessage(conversationId: string, message: Message): Promise<void> {
    const list = this.messages.get(conversationId) ?? [];
    list.push(message);
    this.messages.set(conversationId, list);
    // Same contract as SQLite: appending bumps the conversation's recency.
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      this.conversations.set(conversationId, {
        ...conversation,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
    const list = this.messages.get(conversationId) ?? [];
    const index = list.findIndex((m) => m.id === messageId);
    if (index >= 0) this.messages.set(conversationId, list.slice(0, index + 1));
  }

  async setFeedback(runId: string, feedback: Feedback | null, owner: string): Promise<boolean> {
    for (const [conversationId, list] of this.messages) {
      if (this.owners.get(conversationId) !== owner) continue;
      const index = list.findIndex((m) => m.runId === runId);
      if (index < 0) continue;
      const { feedback: _previous, ...message } = list[index]!;
      const updated = [...list];
      updated[index] = feedback ? { ...message, feedback } : message;
      this.messages.set(conversationId, updated);
      return true;
    }
    return false;
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
