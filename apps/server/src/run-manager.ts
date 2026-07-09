import type { ConversationService, Message } from '@crisp/conversations';
import type { Model } from '@crisp/models/contracts';
import type { GatewayMessage, RunService, RunStreamStore } from '@crisp/runs';
import type { TitleService } from '@crisp/titling';

export interface StartInput {
  conversationId: string;
  /** Minted by the route, which claims the Conversation under it first. */
  runId: string;
  /** The visitor who owns the Conversation (session cookie). */
  owner: string;
  model: Model;
  history: GatewayMessage[];
  userMessage?: Message;
  /** User-supplied provider key (BYOK) — held for this Run only, never stored. */
  apiKey?: string;
}

/**
 * Owns the lifetime of live Runs. A Run executes detached from the HTTP
 * request that started it — clients stream it via RunStreamStore.replay()
 * and may disconnect and reattach freely. Stop is an explicit endpoint,
 * not a dropped connection.
 *
 * The caller claims the Conversation (claimActiveRun) before start(); the
 * manager guarantees the claim is released on every exit path.
 */
export class RunManager {
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly runs: RunService,
    private readonly conversations: ConversationService,
    private readonly titles: TitleService,
    private readonly runStreams: RunStreamStore,
  ) {}

  start(input: StartInput): void {
    const { runId } = input;
    const controller = new AbortController();
    this.controllers.set(runId, controller);

    void (async () => {
      let completed = false;
      try {
        const events = this.runs.execute({ ...input, signal: controller.signal });
        for await (const _ of events) {
          // Drain: RunService tees every event into the RunStreamStore,
          // which is what HTTP responses actually stream from.
        }
        completed = true;
      } catch (error) {
        console.error(`run ${runId} failed outside the event stream`, error);
      } finally {
        this.controllers.delete(runId);
        // Best-effort: if Redis is down the claim key is either gone with it
        // or expires with its TTL — the conversation never locks permanently.
        await this.runStreams.releaseActiveRun(input.conversationId, runId).catch((error) => {
          console.warn(`run ${runId}: failed to release conversation claim`, error);
        });
      }
      if (completed)
        await this.maybeGenerateTitle(input.conversationId, input.owner, input.model, input.apiKey);
    })();
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
  private async maybeGenerateTitle(
    conversationId: string,
    owner: string,
    model: Model,
    apiKey?: string,
  ): Promise<void> {
    const conversation = await this.conversations.get(conversationId, owner);
    if (!conversation || conversation.messages.length !== 2) return;
    const [user, assistant] = conversation.messages;
    if (user?.role !== 'user' || assistant?.role !== 'assistant') return;
    const text = (message: Message) => message.parts.map((p) => p.content).join('');
    await this.titles
      .generate(conversationId, model, text(user), text(assistant), apiKey)
      .catch((error) => {
        console.error(`title generation failed for ${conversationId}`, error);
      });
  }
}
