import type { Feedback } from '@crisp/feedback/contracts';
import type { Conversation, ConversationWithMessages, Message } from './contracts';
import type { ConversationRepository } from './ports';

/**
 * In-memory analogue of the SQLite adapter, playing the same multi-port
 * role: it implements this slice's ConversationRepository and, structurally,
 * runs' MessageStore, titling's ConversationRenamer and feedback's
 * FeedbackStore. The contract test in apps/server keeps it honest against
 * the real adapter.
 */
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
