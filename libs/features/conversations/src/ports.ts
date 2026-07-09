import type { Conversation, ConversationWithMessages } from './contracts';

/**
 * The port for durable Conversation storage — sized to what this slice does:
 * create, read, list, delete. Writing Messages into a Conversation is the
 * runs slice's business (its MessageStore port); renaming is titling's
 * (ConversationRenamer); Feedback is feedback's (FeedbackStore). One adapter
 * satisfies all four at the composition root.
 *
 * `owner` is the anonymous visitor identity (an unguessable session id from
 * an HttpOnly cookie): reads and deletes are scoped to it, so one visitor
 * can never see or touch another's Conversations.
 */
export interface ConversationRepository {
  create(conversation: Conversation, owner: string): Promise<void>;
  get(id: string, owner: string): Promise<ConversationWithMessages | null>;
  list(owner: string): Promise<Conversation[]>;
  delete(id: string, owner: string): Promise<void>;
}
