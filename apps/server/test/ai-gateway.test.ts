import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent, StartRunOptions } from '@crisp/domain';
import type { Model } from '@crisp/contracts';
import { loadEnv } from '../src/infra/env';
import { AiModelGateway } from '../src/infra/ai-gateway';

/**
 * The gateway is tested with the @crisp/ai surface mocked out: `chat` is
 * a controllable async generator and the three adapter factories capture
 * their arguments. This locks down the contracts that matter to Crisp —
 * BYOK key precedence (ADR-0006), typed RUN_ERROR emission, and abort
 * hygiene — without any network.
 */
const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createAnthropicChat: vi.fn(() => ({ adapter: 'anthropic' })),
  createOpenaiChat: vi.fn(() => ({ adapter: 'openai' })),
  openaiCompatibleText: vi.fn(() => ({ adapter: 'compatible' })),
}));

vi.mock('@crisp/ai', () => ({ chat: mocks.chat }));
vi.mock('@crisp/ai/anthropic', () => ({ createAnthropicChat: mocks.createAnthropicChat }));
vi.mock('@crisp/ai/openai', () => ({ createOpenaiChat: mocks.createOpenaiChat }));
vi.mock('@crisp/ai/openai/compatible', () => ({
  openaiCompatibleText: mocks.openaiCompatibleText,
}));

const model = (id: string, provider = 'Anthropic'): Model => ({
  id,
  displayName: id,
  provider,
  provenance: 'remote',
  available: true,
});

const options = (
  modelId: string,
  overrides: Partial<StartRunOptions> & { provider?: string } = {},
): StartRunOptions => {
  const { provider = 'Anthropic', ...rest } = overrides;
  return {
    model: model(modelId, provider),
    messages: [{ role: 'user', content: 'hi' }],
    runId: 'run-1',
    threadId: 'conv-1',
    ...rest,
  };
};

const collect = async (events: AsyncIterable<RunEvent>): Promise<RunEvent[]> => {
  const out: RunEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const happyStream = async function* (): AsyncGenerator<RunEvent> {
  yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'hello' };
  yield { type: 'RUN_FINISHED' };
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chat.mockImplementation(happyStream);
});

describe('BYOK key precedence (ADR-0006)', () => {
  it('uses the server env key when the request carries none', async () => {
    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'env-key' }));
    await collect(gateway.startRun(options('anthropic/claude-haiku-4-5')));
    expect(mocks.createAnthropicChat).toHaveBeenCalledWith('claude-haiku-4-5', 'env-key');
  });

  it('a user-supplied key always wins over the env key', async () => {
    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'env-key' }));
    await collect(gateway.startRun(options('anthropic/claude-haiku-4-5', { apiKey: 'user-key' })));
    expect(mocks.createAnthropicChat).toHaveBeenCalledWith('claude-haiku-4-5', 'user-key');
  });

  it('a user key unlocks a provider the server has no key for', async () => {
    const gateway = new AiModelGateway(loadEnv({}));
    await collect(gateway.startRun(options('openai/gpt-4o-mini', { apiKey: 'user-key' })));
    expect(mocks.createOpenaiChat).toHaveBeenCalledWith('gpt-4o-mini', 'user-key');
  });
});

describe('adapter selection', () => {
  it('routes openrouter through the OpenAI-compatible adapter, keeping slashes in the model name', async () => {
    const gateway = new AiModelGateway(loadEnv({ OPENROUTER_API_KEY: 'or-key' }));
    await collect(gateway.startRun(options('openrouter/meta-llama/llama-3.1-8b-instruct')));
    expect(mocks.openaiCompatibleText).toHaveBeenCalledWith(
      'meta-llama/llama-3.1-8b-instruct',
      expect.objectContaining({ baseURL: 'https://openrouter.ai/api/v1', apiKey: 'or-key' }),
    );
  });

  it('splits system prompts out of the message list', async () => {
    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'k' }));
    await collect(
      gateway.startRun(
        options('anthropic/claude-haiku-4-5', {
          messages: [
            { role: 'system', content: 'be terse' },
            { role: 'user', content: 'hi' },
          ],
        }),
      ),
    );
    const arg = mocks.chat.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.systemPrompts).toEqual(['be terse']);
    expect(arg.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('omits systemPrompts entirely when the conversation has none', async () => {
    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'k' }));
    await collect(gateway.startRun(options('anthropic/claude-haiku-4-5')));
    const arg = mocks.chat.mock.calls[0]![0] as Record<string, unknown>;
    expect('systemPrompts' in arg).toBe(false);
  });
});

describe('failure paths emit typed RUN_ERROR events instead of throwing (ModelGateway port contract)', () => {
  it('missing provider key: yields a single RUN_ERROR naming the env var', async () => {
    const gateway = new AiModelGateway(loadEnv({}));
    const events = await collect(gateway.startRun(options('anthropic/claude-haiku-4-5')));

    expect(events).toHaveLength(1);
    const error = events[0]!;
    expect(error.type).toBe('RUN_ERROR');
    expect(error.message).toContain('ANTHROPIC_API_KEY');
    expect(error.provider).toBe('Anthropic');
    expect(error.runId).toBe('run-1');
    expect(error.threadId).toBe('conv-1');
    // Note: the classifier does not recognize this message today, so it
    // lands on `unknown` (candidate for auth_failed if the copy changes).
    expect(error.code).toBe('unknown');
    expect(mocks.chat).not.toHaveBeenCalled();
  });

  it('unknown provider id: yields RUN_ERROR, never throws', async () => {
    const gateway = new AiModelGateway(loadEnv({}));
    const events = await collect(
      gateway.startRun(options('mystery/model-x', { provider: 'Mystery' })),
    );
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('RUN_ERROR');
    expect(events[0]!.message).toContain('Unknown provider "mystery"');
  });

  it('re-emits an upstream RUN_ERROR with a taxonomy code and stops the stream', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<RunEvent> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' };
      yield { type: 'RUN_ERROR', message: '429 Too Many Requests' };
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'never delivered' };
    });
    const gateway = new AiModelGateway(loadEnv({ OPENAI_API_KEY: 'k' }));
    const events = await collect(
      gateway.startRun(options('openai/gpt-4o-mini', { provider: 'OpenAI' })),
    );

    expect(events.map((e) => e.type)).toEqual(['TEXT_MESSAGE_CONTENT', 'RUN_ERROR']);
    const error = events[1]!;
    expect(error.code).toBe('rate_limited');
    expect(error.provider).toBe('OpenAI');
    expect(error.runId).toBe('run-1');
    expect(typeof error.timestamp).toBe('number');
  });

  it('classifies using the upstream code as well as the message', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<RunEvent> {
      yield { type: 'RUN_ERROR', message: 'Request failed', code: 'invalid_api_key' };
    });
    const gateway = new AiModelGateway(loadEnv({ OPENAI_API_KEY: 'k' }));
    const events = await collect(
      gateway.startRun(options('openai/gpt-4o-mini', { provider: 'OpenAI' })),
    );
    expect(events[0]!.code).toBe('auth_failed');
  });

  it('a mid-stream throw becomes a classified RUN_ERROR', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<RunEvent> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' };
      throw new Error('fetch failed');
    });
    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'k' }));
    const events = await collect(gateway.startRun(options('anthropic/claude-haiku-4-5')));

    expect(events.map((e) => e.type)).toEqual(['TEXT_MESSAGE_CONTENT', 'RUN_ERROR']);
    expect(events[1]!.code).toBe('provider_unavailable');
    expect(events[1]!.message).toBe('fetch failed');
  });
});

describe('abort hygiene', () => {
  it('propagates an external abort to the inner controller and rethrows', async () => {
    const controller = new AbortController();
    let innerSignal: AbortSignal | undefined;
    mocks.chat.mockImplementation(async function* (arg: {
      abortController: AbortController;
    }): AsyncGenerator<RunEvent> {
      innerSignal = arg.abortController.signal;
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'first' };
      controller.abort();
      throw new Error('The operation was aborted');
    });

    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'k' }));
    const stream = gateway.startRun(
      options('anthropic/claude-haiku-4-5', { signal: controller.signal }),
    );

    // A stop is the consumer's doing: the gateway rethrows instead of
    // emitting RUN_ERROR, so the run manager can persist the partial.
    await expect(collect(stream)).rejects.toThrow('aborted');
    expect(innerSignal?.aborted).toBe(true);
  });

  it('removes its abort listener when the stream completes normally', async () => {
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');

    const gateway = new AiModelGateway(loadEnv({ ANTHROPIC_API_KEY: 'k' }));
    await collect(
      gateway.startRun(options('anthropic/claude-haiku-4-5', { signal: controller.signal })),
    );

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]![1]).toBe(add.mock.calls[0]![1]); // the same listener, actually detached
  });
});
