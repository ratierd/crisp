import type { Model } from '@crisp/models/contracts';
import type { ConversationRenamer, TitleModel } from './ports';

const TITLE_PROMPT =
  'Reply with a short title (max six words) for this conversation. ' +
  'Plain text only: no quotes, no punctuation at the end, no preamble.';

/** Cleans a model-generated title; returns null when unusable. */
export const sanitizeGeneratedTitle = (raw: string): string | null => {
  const flat = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”]+|["'“”.]+$/g, '')
    .trim();
  if (flat.length < 3) return null;
  return flat.length <= 60 ? flat : `${flat.slice(0, 59).trimEnd()}…`;
};

export interface TitleServiceDeps {
  model: TitleModel;
  conversations: ConversationRenamer;
}

/** Fire-and-forget Conversation auto-titling with the selected Model. */
export class TitleService {
  constructor(private readonly deps: TitleServiceDeps) {}

  async generate(
    conversationId: string,
    model: Model,
    userText: string,
    assistantText: string,
    apiKey?: string,
  ): Promise<void> {
    let title = '';
    const events = this.deps.model.startRun({
      model,
      // a real UUID: title runs flow through the same gateway decorators
      // (tracing), and observability backends require UUID run ids
      runId: crypto.randomUUID(),
      threadId: conversationId,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        {
          role: 'user',
          content: `User: ${userText.slice(0, 500)}\n\nAssistant: ${assistantText.slice(0, 500)}`,
        },
      ],
      // the same BYOK key that ran the exchange also titles it
      ...(apiKey ? { apiKey } : {}),
    });
    for await (const event of events) {
      if (event.type === 'RUN_ERROR') return; // keep the fallback title
      if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string') {
        title += event.delta;
      }
    }
    const sanitized = sanitizeGeneratedTitle(title);
    if (sanitized === null) return; // keep the fallback title
    await this.deps.conversations.rename(conversationId, sanitized);
  }
}
