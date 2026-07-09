// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://crisp.example.dev/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model } from '@crisp/contracts';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  createOllamaChat: vi.fn(() => ({ adapter: 'ollama' })),
  sseConnect: vi.fn(),
  postByoRun: vi.fn(async (_conversationId: string, _run: Record<string, unknown>) => undefined),
}));

// only the model call is faked — the wire codec stays real
vi.mock('@crisp/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@crisp/ai')>()),
  chat: mocks.chat,
}));
vi.mock('@crisp/ai/ollama', () => ({ createOllamaChat: mocks.createOllamaChat }));
vi.mock('@crisp/ai/client', () => ({
  fetchServerSentEvents: vi.fn(() => ({ connect: mocks.sseConnect })),
}));
vi.mock('./api', () => ({ postByoRun: mocks.postByoRun }));

import {
  byoConnectCommand,
  crispConnection,
  discoverByoModels,
  isByoModelId,
  shouldAutoDiscover,
} from './byo';

const CONNECTED_KEY = 'crisp:byo-connected';

const byoModel: Model = {
  id: 'byo/llama3.2:3b',
  displayName: 'llama3.2:3b',
  provider: 'Ollama (yours)',
  provenance: 'local',
  available: true,
};

interface Chunk {
  type: string;
  [key: string]: unknown;
}

/** Drives the browser-side gateway through the app's connection adapter. */
const runByo = (wireMessages: unknown[], signal?: AbortSignal) => {
  const adapter = crispConnection(() => byoModel) as unknown as {
    connect: (
      m: unknown,
      d: unknown,
      s?: AbortSignal,
      ctx?: { threadId: string },
    ) => AsyncIterable<Chunk>;
  };
  return adapter.connect(wireMessages, undefined, signal, { threadId: 'conv-1' });
};

const collect = async (events: AsyncIterable<Chunk>) => {
  const out: Chunk[] = [];
  for await (const event of events) out.push(event);
  return out;
};

const userWire = (content: string) => ({
  id: 'u-1',
  role: 'user',
  parts: [{ type: 'text', content }],
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
    yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' };
    yield { type: 'RUN_FINISHED' };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldAutoDiscover on a deployed origin', () => {
  it('is off by default: probing would be a guaranteed CORS error for most visitors', () => {
    expect(shouldAutoDiscover()).toBe(false);
  });

  it('turns on once this browser has ever connected', () => {
    localStorage.setItem(CONNECTED_KEY, '1');
    expect(shouldAutoDiscover()).toBe(true);
  });

  it('shows the connect command for exactly this origin', () => {
    expect(byoConnectCommand()).toBe('OLLAMA_ORIGINS=https://crisp.example.dev ollama serve');
  });
});

describe('discoverByoModels', () => {
  it('maps /api/tags into byo/ models and remembers the success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ models: [{ name: 'llama3.2:3b' }, { name: 'qwen2.5:7b' }] }),
      ),
    );
    const models = await discoverByoModels();
    expect(models.map((m) => m.id)).toEqual(['byo/llama3.2:3b', 'byo/qwen2.5:7b']);
    expect(models[0]).toMatchObject({
      provider: 'Ollama (yours)',
      provenance: 'local',
      available: true,
    });
    expect(localStorage.getItem(CONNECTED_KEY)).toBe('1');
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe('http://localhost:11434/api/tags');
  });

  it('is silent on network failure and does not set the connected flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('CORS'))),
    );
    expect(await discoverByoModels()).toEqual([]);
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
  });

  it('treats a non-ok response and an empty tag list as not connected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    expect(await discoverByoModels()).toEqual([]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ models: [] })),
    );
    expect(await discoverByoModels()).toEqual([]);
    expect(localStorage.getItem(CONNECTED_KEY)).toBeNull();
  });
});

describe('crispConnection routing', () => {
  it('byo/ ids run in the page; everything else goes to the server SSE connection', async () => {
    expect(isByoModelId('byo/llama3.2:3b')).toBe(true);
    expect(isByoModelId('anthropic/claude-haiku-4-5')).toBe(false);

    await collect(runByo([userWire('hi')]));
    expect(mocks.chat).toHaveBeenCalledTimes(1);
    expect(mocks.sseConnect).not.toHaveBeenCalled();

    const serverAdapter = crispConnection(() => ({ ...byoModel, id: 'demo/demo' })) as unknown as {
      connect: (...args: unknown[]) => unknown;
    };
    mocks.sseConnect.mockReturnValue((async function* () {})());
    serverAdapter.connect([], undefined, undefined, { threadId: 'conv-1' });
    expect(mocks.sseConnect).toHaveBeenCalledTimes(1);
  });

  it('strips the byo/ prefix and targets the local daemon', async () => {
    await collect(runByo([userWire('hi')]));
    expect(mocks.createOllamaChat).toHaveBeenCalledWith('llama3.2:3b', 'http://localhost:11434');
  });
});

describe('runByoModel reporting (persistence before RUN_FINISHED)', () => {
  it('reports a completed run exactly once, before RUN_FINISHED reaches the consumer', async () => {
    const order: string[] = [];
    mocks.postByoRun.mockImplementation(async () => {
      order.push('reported');
    });

    for await (const chunk of runByo([userWire('hello there')])) {
      order.push(chunk.type);
    }

    expect(order).toEqual(['TEXT_MESSAGE_CONTENT', 'reported', 'RUN_FINISHED']);
    expect(mocks.postByoRun).toHaveBeenCalledTimes(1); // the finally-path must not double-report

    const [threadId, report] = mocks.postByoRun.mock.calls[0]! as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(threadId).toBe('conv-1');
    expect(report).toMatchObject({
      modelId: 'byo/llama3.2:3b',
      assistantText: 'hi',
      outcome: 'completed',
      history: [{ role: 'user', content: 'hello there' }],
    });
    expect(report.userMessage).toMatchObject({
      id: 'u-1',
      role: 'user',
      parts: [{ type: 'text', content: 'hello there' }],
    });
  });

  it('computes ttft and chunk-rate stats from the stream timeline', async () => {
    // performance.now sequence: run start, first token, report time
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(1_000).mockReturnValueOnce(1_250).mockReturnValueOnce(2_250);
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'a' };
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'b' };
      yield { type: 'RUN_FINISHED' };
    });

    await collect(runByo([userWire('hi')]));

    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as {
      stats: { ttftMs: number; tokensPerSec: number; durationMs: number };
    };
    expect(report.stats.ttftMs).toBe(250);
    expect(report.stats.tokensPerSec).toBe(2); // 2 chunks over 1s of streaming
    expect(report.stats.durationMs).toBe(1250); // run start to report time
    now.mockRestore();
  });

  it('forwards usage from RUN_FINISHED into the report', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'x' };
      yield {
        type: 'RUN_FINISHED',
        usage: { promptTokens: 3, completionTokens: 5, totalTokens: 8 },
      };
    });
    await collect(runByo([userWire('hi')]));
    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(report.usage).toEqual({ promptTokens: 3, completionTokens: 5, totalTokens: 8 });
  });

  it('splits system prompts out and keeps only meaningful history', async () => {
    await collect(
      runByo([
        { role: 'system', content: 'be nice' },
        { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] },
        { role: 'tool', content: 'ignored' },
        { role: 'user', content: '' }, // empty: filtered from history
        userWire('question'),
      ]),
    );
    const chatArg = mocks.chat.mock.calls[0]![0] as Record<string, unknown>;
    expect(chatArg.systemPrompts).toEqual(['be nice']);
    expect(chatArg.messages).toEqual([
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'question' },
    ]);
    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as { history: unknown };
    expect(report.history).toEqual([
      { role: 'system', content: 'be nice' },
      { role: 'assistant', content: 'earlier answer' },
      { role: 'user', content: 'question' },
    ]);
  });

  it('a thrown provider error becomes a typed RUN_ERROR and a failed report', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'par' };
      throw new Error('fetch failed');
    });

    const events = await collect(runByo([userWire('hi')]));
    expect(events.map((e) => e.type)).toEqual(['TEXT_MESSAGE_CONTENT', 'RUN_ERROR']);
    expect(events[1]).toMatchObject({
      code: 'provider_unavailable',
      provider: 'your Ollama',
      message: 'fetch failed',
    });

    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(report).toMatchObject({
      outcome: 'failed',
      error: 'fetch failed',
      assistantText: 'par',
    });
  });

  it('an upstream RUN_ERROR chunk is re-emitted typed and ends the stream', async () => {
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
      yield { type: 'RUN_ERROR', message: 'model not found' };
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'never delivered' };
    });

    const events = await collect(runByo([userWire('hi')]));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'RUN_ERROR',
      code: 'provider_unavailable',
      provider: 'your Ollama',
    });

    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(report.outcome).toBe('failed');
  });

  it('a user stop reports the partial as stopped, with no error card', async () => {
    const controller = new AbortController();
    mocks.chat.mockImplementation(async function* (): AsyncGenerator<Chunk> {
      yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial ' };
      controller.abort();
      throw new Error('The operation was aborted');
    });

    const events = await collect(runByo([userWire('hi')], controller.signal));
    expect(events.map((e) => e.type)).toEqual(['TEXT_MESSAGE_CONTENT']); // no RUN_ERROR for a stop

    const report = mocks.postByoRun.mock.calls[0]![1] as unknown as Record<string, unknown>;
    expect(report).toMatchObject({ outcome: 'stopped', assistantText: 'partial ' });
    expect(report.error).toBeUndefined();
  });
});
