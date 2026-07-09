import type { Conversation, ConversationWithMessages } from './contracts';
import type { ConversationRepository } from './ports';

const TITLE_MAX = 44;

/** Fallback Conversation title: the first user message, truncated. */
export const deriveFallbackTitle = (firstUserText: string): string => {
  const flat = firstUserText.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return 'New conversation';
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
};

export interface ConversationServiceDeps {
  conversations: ConversationRepository;
  now?: () => Date;
  newId?: () => string;
}

export class ConversationService {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly deps: ConversationServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  async create(firstUserText: string, owner: string, id?: string): Promise<Conversation> {
    const at = this.now().toISOString();
    const conversation: Conversation = {
      id: id ?? this.newId(),
      title: deriveFallbackTitle(firstUserText),
      createdAt: at,
      updatedAt: at,
    };
    await this.deps.conversations.create(conversation, owner);
    return conversation;
  }

  get(id: string, owner: string): Promise<ConversationWithMessages | null> {
    return this.deps.conversations.get(id, owner);
  }

  list(owner: string): Promise<Conversation[]> {
    return this.deps.conversations.list(owner);
  }

  delete(id: string, owner: string): Promise<void> {
    return this.deps.conversations.delete(id, owner);
  }
}
