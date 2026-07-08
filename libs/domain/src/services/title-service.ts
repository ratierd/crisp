import type { Model } from '@crisp/contracts';
import type { ModelGateway } from '../ports';
import type { ConversationService } from './conversation-service';

const TITLE_PROMPT =
  'Reply with a short title (max six words) for this conversation. ' +
  'Plain text only: no quotes, no punctuation at the end, no preamble.';

export interface TitleServiceDeps {
  gateway: ModelGateway;
  conversations: ConversationService;
}

/** Fire-and-forget Conversation auto-titling with the selected Model. */
export class TitleService {
  constructor(private readonly deps: TitleServiceDeps) {}

  async generate(conversationId: string, model: Model, userText: string, assistantText: string): Promise<void> {
    let title = '';
    const events = this.deps.gateway.startRun({
      model,
      // a real UUID: title runs flow through the same gateway decorators
      // (tracing), and observability backends require UUID run ids
      runId: crypto.randomUUID(),
      threadId: conversationId,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        { role: 'user', content: `User: ${userText.slice(0, 500)}\n\nAssistant: ${assistantText.slice(0, 500)}` },
      ],
    });
    for await (const event of events) {
      if (event.type === 'RUN_ERROR') return; // keep the fallback title
      if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string') {
        title += event.delta;
      }
    }
    await this.deps.conversations.applyGeneratedTitle(conversationId, title);
  }
}
