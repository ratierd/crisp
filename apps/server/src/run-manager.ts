import type { Message, Model } from '@crisp/contracts';
import type { ConversationService, GatewayMessage, RunService, TitleService } from '@crisp/domain';

export interface StartInput {
  conversationId: string;
  model: Model;
  history: GatewayMessage[];
  userMessage?: Message;
}

/**
 * Owns the lifetime of live Runs. A Run executes detached from the HTTP
 * request that started it — clients stream it via RunStreamStore.replay()
 * and may disconnect and reattach freely. Stop is an explicit endpoint,
 * not a dropped connection.
 */
export class RunManager {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly runs: RunService,
    private readonly conversations: ConversationService,
    private readonly titles: TitleService,
  ) {}

  start(input: StartInput): string {
    const runId = crypto.randomUUID();
    const controller = new AbortController();
    this.controllers.set(runId, controller);

    void (async () => {
      try {
        const events = this.runs.execute({ ...input, runId, signal: controller.signal });
        for await (const _ of events) {
          // Drain: RunService tees every event into the RunStreamStore,
          // which is what HTTP responses actually stream from.
        }
        await this.maybeGenerateTitle(input.conversationId, input.model);
      } catch (error) {
        console.error(`run ${runId} failed outside the event stream`, error);
      } finally {
        this.controllers.delete(runId);
      }
    })();

    return runId;
  }

  /** Returns false when the Run is not live (already finished, stopping, or unknown). */
  stop(runId: string): boolean {
    const controller = this.controllers.get(runId);
    if (!controller || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  get liveRunCount(): number {
    return this.controllers.size;
  }

  /** Auto-title after the first exchange, with the Model that answered. */
  private async maybeGenerateTitle(conversationId: string, model: Model): Promise<void> {
    const conversation = await this.conversations.get(conversationId);
    if (!conversation || conversation.messages.length !== 2) return;
    const [user, assistant] = conversation.messages;
    if (user?.role !== 'user' || assistant?.role !== 'assistant') return;
    const text = (message: Message) => message.parts.map((p) => p.content).join('');
    await this.titles.generate(conversationId, model, text(user), text(assistant)).catch((error) => {
      console.error(`title generation failed for ${conversationId}`, error);
    });
  }
}
