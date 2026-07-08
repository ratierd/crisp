import { chat } from '@crisp/ai';
import { createAnthropicChat } from '@crisp/ai/anthropic';
import { createOpenaiChat } from '@crisp/ai/openai';
import { openaiCompatibleText } from '@crisp/ai/openai/compatible';
import type { ModelGateway, RunEvent, StartRunOptions } from '@crisp/domain';
import { classifyProviderError } from './classify-error';
import { demoRun, type DemoProviderOptions } from './demo-provider';
import type { Env } from './env';

type AnthropicModel = Parameters<typeof createAnthropicChat>[0];
type OpenaiModel = Parameters<typeof createOpenaiChat>[0];

/**
 * ModelGateway adapter over @crisp/ai. Model ids are `<provider>/<name>`;
 * the name is passed to the provider adapter untouched. Raw RUN_ERROR events
 * are re-emitted with a taxonomy `code` and the human provider name so the
 * client can render the right error card.
 */
export class AiModelGateway implements ModelGateway {
  constructor(
    private readonly env: Env,
    private readonly demoOptions: DemoProviderOptions = {},
  ) {}

  async *startRun(options: StartRunOptions): AsyncIterable<RunEvent> {
    const [providerId, ...rest] = options.model.id.split('/');
    const modelName = rest.join('/');

    if (providerId === 'demo') {
      yield* demoRun(options, this.demoOptions);
      return;
    }

    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    // System prompts travel separately in @crisp/ai; conversation
    // messages are user/assistant only.
    const systemPrompts = options.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const messages = options.messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const stream = chat({
        adapter: this.adapterFor(providerId ?? '', modelName, options.apiKey),
        messages,
        ...(systemPrompts.length > 0 ? { systemPrompts } : {}),
        threadId: options.threadId,
        runId: options.runId,
        abortController,
      });
      for await (const event of stream as AsyncIterable<RunEvent>) {
        if (event.type === 'RUN_ERROR') {
          yield this.typedError(options, event);
          return;
        }
        yield event;
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      yield this.typedError(options, {
        type: 'RUN_ERROR',
        runId: options.runId,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  // A user-supplied key (BYOK, ADR-0006) always wins over the server's env
  // key: the visitor asked for their own account to be billed.
  private adapterFor(providerId: string, modelName: string, userKey?: string) {
    switch (providerId) {
      case 'anthropic': {
        const key = userKey ?? this.env.anthropicApiKey;
        if (!key) throw new Error('ANTHROPIC_API_KEY is missing from the environment.');
        return createAnthropicChat(modelName as AnthropicModel, key);
      }
      case 'openai': {
        const key = userKey ?? this.env.openaiApiKey;
        if (!key) throw new Error('OPENAI_API_KEY is missing from the environment.');
        return createOpenaiChat(modelName as OpenaiModel, key);
      }
      case 'openrouter': {
        const key = userKey ?? this.env.openrouterApiKey;
        if (!key) throw new Error('OPENROUTER_API_KEY is missing from the environment.');
        return openaiCompatibleText(modelName, {
          name: 'openrouter',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: key,
          api: 'chat-completions',
          defaultHeaders: { 'X-Title': 'Crisp' },
        });
      }
      default:
        throw new Error(`Unknown provider "${providerId}".`);
    }
  }

  private typedError(options: StartRunOptions, event: RunEvent): RunEvent {
    const message = typeof event.message === 'string' ? event.message : 'The run failed.';
    const rawCode = typeof event.code === 'string' ? event.code : undefined;
    return {
      ...event,
      type: 'RUN_ERROR',
      runId: options.runId,
      threadId: options.threadId,
      message,
      code: classifyProviderError(message, rawCode),
      provider: options.model.provider,
      timestamp: Date.now(),
    };
  }
}
