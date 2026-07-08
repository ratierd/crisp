import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Conversation, ConversationWithMessages, Feedback, Message } from '@crisp/contracts';
import { messageSchema } from '@crisp/contracts';
import type { ConversationRepository } from '@crisp/domain';

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  payload: string;
}

export class SqliteConversationRepository implements ConversationRepository {
  private readonly db: Database;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        payload TEXT NOT NULL,
        PRIMARY KEY (conversation_id, id)
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, seq);
    `);
  }

  async create(conversation: Conversation): Promise<void> {
    this.db
      .query('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)')
      .run(conversation.id, conversation.title, conversation.createdAt, conversation.updatedAt);
  }

  async get(id: string): Promise<ConversationWithMessages | null> {
    const row = this.db.query<ConversationRow, [string]>('SELECT * FROM conversations WHERE id = ?1').get(id);
    if (!row) return null;
    const messageRows = this.db
      .query<MessageRow, [string]>('SELECT payload FROM messages WHERE conversation_id = ?1 ORDER BY seq')
      .all(id);
    const messages = messageRows.map((m): Message => messageSchema.parse(JSON.parse(m.payload)));
    return { ...toConversation(row), messages, activeRunId: null };
  }

  async list(): Promise<Conversation[]> {
    return this.db
      .query<ConversationRow, []>('SELECT * FROM conversations ORDER BY updated_at DESC')
      .all()
      .map(toConversation);
  }

  async rename(id: string, title: string): Promise<void> {
    this.db.query('UPDATE conversations SET title = ?2 WHERE id = ?1').run(id, title);
  }

  async delete(id: string): Promise<void> {
    this.db.query('DELETE FROM conversations WHERE id = ?1').run(id);
  }

  async appendMessage(conversationId: string, message: Message): Promise<void> {
    const next = this.db
      .query<{ next: number }, [string]>(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM messages WHERE conversation_id = ?1',
      )
      .get(conversationId);
    this.db
      .query('INSERT INTO messages (id, conversation_id, seq, payload) VALUES (?1, ?2, ?3, ?4)')
      .run(message.id, conversationId, next?.next ?? 1, JSON.stringify(message));
    this.db
      .query('UPDATE conversations SET updated_at = ?2 WHERE id = ?1')
      .run(conversationId, new Date().toISOString());
  }

  async setFeedback(runId: string, feedback: Feedback | null): Promise<boolean> {
    const row = this.db
      .query<{ conversation_id: string; id: string; payload: string }, [string]>(
        "SELECT conversation_id, id, payload FROM messages WHERE json_extract(payload, '$.runId') = ?1",
      )
      .get(runId);
    if (!row) return false;
    const { feedback: _previous, ...message } = messageSchema.parse(JSON.parse(row.payload));
    const updated: Message = feedback ? { ...message, feedback } : message;
    this.db
      .query('UPDATE messages SET payload = ?3 WHERE conversation_id = ?1 AND id = ?2')
      .run(row.conversation_id, row.id, JSON.stringify(updated));
    return true;
  }

  async deleteMessagesAfter(conversationId: string, messageId: string): Promise<void> {
    const anchor = this.db
      .query<{ seq: number }, [string, string]>(
        'SELECT seq FROM messages WHERE conversation_id = ?1 AND id = ?2',
      )
      .get(conversationId, messageId);
    if (!anchor) return;
    this.db
      .query('DELETE FROM messages WHERE conversation_id = ?1 AND seq > ?2')
      .run(conversationId, anchor.seq);
  }

  close(): void {
    this.db.close();
  }
}

const toConversation = (row: ConversationRow): Conversation => ({
  id: row.id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
