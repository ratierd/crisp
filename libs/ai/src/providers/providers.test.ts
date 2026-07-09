import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnthropicChat } from './anthropic';
import { createOllamaChat } from './ollama';
import { openaiCompatibleText } from './openai-compatible';
import { createOpenaiChat } from './openai';
import type { AdapterEvent } from '../core/types';

/**
 * Each provider adapter is tested against a canned copy of its real wire
 * format — SSE for Anthropic/OpenAI, NDJSON for Ollama — asserting both the
 * request it builds and the normalized events it yields.
 */

const sse = (...events: unknown[]): string =>
  events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

const stubFetch = (body: string, init: ResponseInit = {}) => {
  const mock = vi.fn(async () => new Response(body, { status: 200, ...init }));
  vi.stubGlobal('fetch', mock);
  return mock;
};

const requestOf = (
  mock: ReturnType<typeof vi.fn>,
): { url: string; init: RequestInit; body: Record<string, unknown> } => {
  const [url, init] = mock.mock.calls[0] as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> };
};

const collect = async (stream: AsyncIterable<AdapterEvent>): Promise<AdapterEvent[]> => {
  const out: AdapterEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
};

const turns = [{ role: 'user' as const, content: 'hi' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('anthropic adapter', () => {
  const happyBody = sse(
    { type: 'message_start', message: { usage: { input_tokens: 7, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0 },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hel' } },
    { type: 'content_block_delta', delta: { type: 'text_delta', text: 'lo' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    { type: 'message_stop' },
  );

  it('speaks the Messages API: url, auth header, version, body', async () => {
    const mock = stubFetch(happyBody);
    await collect(
      createAnthropicChat('claude-haiku-4-5', 'key-1').chatStream({
        messages: turns,
        systemPrompts: ['be nice', 'be terse'],
      }),
    );
    const { url, init, body } = requestOf(mock);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(new Headers(init.headers).get('x-api-key')).toBe('key-1');
    expect(new Headers(init.headers).get('anthropic-version')).toBeTruthy();
    expect(body).toMatchObject({
      model: 'claude-haiku-4-5',
      system: 'be nice\nbe terse',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    expect(typeof body.max_tokens).toBe('number');
  });

  it('normalizes the SSE stream into deltas and cumulative usage', async () => {
    stubFetch(happyBody);
    const events = await collect(
      createAnthropicChat('claude-haiku-4-5', 'k').chatStream({ messages: turns }),
    );
    expect(events).toEqual([
      { type: 'text-delta', delta: 'hel' },
      { type: 'text-delta', delta: 'lo' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 7, completionTokens: 4, totalTokens: 11 },
      },
    ]);
  });

  it('a non-2xx response throws with the status and the raw provider message', async () => {
    stubFetch(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      }),
      {
        status: 401,
        statusText: 'Unauthorized',
      },
    );
    await expect(
      collect(createAnthropicChat('m', 'bad').chatStream({ messages: turns })),
    ).rejects.toThrow(/status 401.*invalid x-api-key/);
  });

  it('an in-band error event throws with the provider message', async () => {
    stubFetch(sse({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
    await expect(
      collect(createAnthropicChat('m', 'k').chatStream({ messages: turns })),
    ).rejects.toThrow('Overloaded');
  });

  it('hands the abort signal to fetch', async () => {
    const mock = stubFetch(happyBody);
    const controller = new AbortController();
    await collect(
      createAnthropicChat('m', 'k').chatStream({ messages: turns, signal: controller.signal }),
    );
    expect((mock.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(
      controller.signal,
    );
  });
});

describe('openai-compatible adapter', () => {
  const happyBody = sse(
    { choices: [{ delta: { role: 'assistant', content: '' } }] },
    { choices: [{ delta: { content: 'hel' } }] },
    { choices: [{ delta: { content: 'lo' }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 6, completion_tokens: 2, total_tokens: 8 } },
    '[DONE]',
  );

  it('POSTs chat-completions to the configured baseURL with bearer auth and extra headers', async () => {
    const mock = stubFetch(happyBody);
    const adapter = openaiCompatibleText('meta-llama/llama-3.1-8b-instruct', {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'or-key',
      api: 'chat-completions',
      defaultHeaders: { 'X-Title': 'Crisp' },
    });
    await collect(adapter.chatStream({ messages: turns, systemPrompts: ['be terse'] }));
    const { url, init, body } = requestOf(mock);
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer or-key');
    expect(new Headers(init.headers).get('x-title')).toBe('Crisp');
    expect(body).toMatchObject({
      model: 'meta-llama/llama-3.1-8b-instruct',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('normalizes chunks, the finish reason and the trailing usage frame', async () => {
    stubFetch(happyBody);
    const adapter = openaiCompatibleText('m', {
      baseURL: 'https://api.example.com/v1',
      apiKey: 'k',
    });
    const events = await collect(adapter.chatStream({ messages: turns }));
    expect(events).toEqual([
      { type: 'text-delta', delta: 'hel' },
      { type: 'text-delta', delta: 'lo' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 6, completionTokens: 2, totalTokens: 8 },
      },
    ]);
  });

  it('a mid-stream error chunk (the OpenRouter way) throws with the raw message', async () => {
    stubFetch(sse({ error: { message: 'Rate limit exceeded', code: 429 } }));
    const adapter = openaiCompatibleText('m', {
      baseURL: 'https://api.example.com/v1',
      apiKey: 'k',
    });
    await expect(collect(adapter.chatStream({ messages: turns }))).rejects.toThrow(
      'Rate limit exceeded',
    );
  });

  it('a non-2xx response throws with the status and provider message', async () => {
    stubFetch(
      JSON.stringify({ error: { message: 'Incorrect API key provided', code: 'invalid_api_key' } }),
      {
        status: 401,
        statusText: 'Unauthorized',
      },
    );
    const adapter = openaiCompatibleText('m', {
      baseURL: 'https://api.example.com/v1',
      apiKey: 'bad',
    });
    await expect(collect(adapter.chatStream({ messages: turns }))).rejects.toThrow(
      /status 401.*Incorrect API key/,
    );
  });
});

describe('openai adapter', () => {
  it('is the compatible adapter pointed at api.openai.com', async () => {
    const mock = stubFetch(sse('[DONE]'));
    await collect(createOpenaiChat('gpt-4o-mini', 'sk-1').chatStream({ messages: turns }));
    const { url, init } = requestOf(mock);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-1');
  });
});

describe('ollama adapter', () => {
  const ndjson = (...docs: unknown[]) => docs.map((d) => `${JSON.stringify(d)}\n`).join('');
  const happyBody = ndjson(
    { message: { role: 'assistant', content: 'hel' }, done: false },
    { message: { role: 'assistant', content: 'lo' }, done: false },
    {
      message: { role: 'assistant', content: '' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 2,
    },
  );

  it('POSTs /api/chat on the daemon with the system prompt folded in', async () => {
    const mock = stubFetch(happyBody);
    await collect(
      createOllamaChat('llama3.2:3b', 'http://localhost:11434').chatStream({
        messages: turns,
        systemPrompts: ['be nice'],
      }),
    );
    const { url, body } = requestOf(mock);
    expect(url).toBe('http://localhost:11434/api/chat');
    expect(body).toMatchObject({
      model: 'llama3.2:3b',
      messages: [
        { role: 'system', content: 'be nice' },
        { role: 'user', content: 'hi' },
      ],
      stream: true,
    });
  });

  it('normalizes NDJSON chunks and reads usage off the done line', async () => {
    stubFetch(happyBody);
    const events = await collect(createOllamaChat('llama3.2:3b').chatStream({ messages: turns }));
    expect(events).toEqual([
      { type: 'text-delta', delta: 'hel' },
      { type: 'text-delta', delta: 'lo' },
      {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7 },
      },
    ]);
  });

  it('an error line throws with the daemon message', async () => {
    stubFetch(ndjson({ error: 'model "nope" not found' }));
    await expect(collect(createOllamaChat('nope').chatStream({ messages: turns }))).rejects.toThrow(
      'model "nope" not found',
    );
  });

  it('a non-2xx response throws with the status', async () => {
    stubFetch(JSON.stringify({ error: 'something broke' }), {
      status: 500,
      statusText: 'Internal Server Error',
    });
    await expect(collect(createOllamaChat('m').chatStream({ messages: turns }))).rejects.toThrow(
      /status 500.*something broke/,
    );
  });
});
