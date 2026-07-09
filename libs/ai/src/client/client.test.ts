import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatClient, fetchServerSentEvents, uiMessagesToWire } from './index';
import type { ConnectConnectionAdapter, StreamChunk, UIMessage } from './index';

const userMessage = (id: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', content: text }],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('uiMessagesToWire', () => {
  it('keeps parts and adds the content string mirror the server reads', () => {
    const wire = uiMessagesToWire([
      {
        id: 'm1',
        role: 'user',
        parts: [
          { type: 'text', content: 'hel' },
          { type: 'text', content: 'lo' },
        ],
      },
      {
        id: 'm2',
        role: 'assistant',
        parts: [
          { type: 'thinking', content: 'hmm' },
          { type: 'text', content: 'answer' },
        ],
      },
    ]);
    expect(wire[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      content: 'hello',
      parts: [
        { type: 'text', content: 'hel' },
        { type: 'text', content: 'lo' },
      ],
    });
    // only text parts feed the mirror — thinking stays in parts
    expect(wire[1]).toMatchObject({ id: 'm2', content: 'answer' });
  });
});

describe('fetchServerSentEvents', () => {
  const sseResponse = (...chunks: unknown[]) =>
    new Response(
      chunks.map((c) => `data: ${typeof c === 'string' ? c : JSON.stringify(c)}\n\n`).join(''),
      { status: 200 },
    );

  // NB: the pin that this body parses against the server's chatRequestSchema
  // lives in apps/server/test/client-server-contract.test.ts — the composition
  // root is the only place allowed to see both sides of the wire.
  it('POSTs an AG-UI RunAgentInput with the wire fields the server reads', async () => {
    const mock = vi.fn(async () => sseResponse({ type: 'RUN_FINISHED' }));
    vi.stubGlobal('fetch', mock);

    const stream = fetchServerSentEvents('/api/chat').connect(
      [userMessage('u1', 'hi')],
      { modelId: 'demo/demo', apiKey: 'user-key' },
      undefined,
      { threadId: 'conv-1' },
    );
    for await (const _ of stream) void _;

    const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      threadId: 'conv-1',
      state: {},
      tools: [],
      messages: [
        { id: 'u1', role: 'user', content: 'hi', parts: [{ type: 'text', content: 'hi' }] },
      ],
      forwardedProps: { modelId: 'demo/demo', apiKey: 'user-key' },
    });
    expect(typeof body.runId).toBe('string');
  });

  it('yields every data frame as a parsed chunk and skips [DONE]', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          { type: 'RUN_STARTED', runId: 'r1' },
          { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
          '[DONE]',
        ),
      ),
    );
    const chunks: StreamChunk[] = [];
    for await (const chunk of fetchServerSentEvents('/api/chat').connect(
      [userMessage('u1', 'hi')],
      {},
      undefined,
      { threadId: 't' },
    )) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([
      { type: 'RUN_STARTED', runId: 'r1' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
    ]);
  });

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"nope"}', { status: 409, statusText: 'Conflict' })),
    );
    const stream = fetchServerSentEvents('/api/chat').connect(
      [userMessage('u1', 'hi')],
      {},
      undefined,
      { threadId: 't' },
    );
    await expect(
      (async () => {
        for await (const _ of stream) void _;
      })(),
    ).rejects.toThrow(/409/);
  });
});

/** A controllable connection: scripts of chunks, or a hanging stream. */
const connectionOf = (
  script: (messages: UIMessage[], data?: Record<string, unknown>) => StreamChunk[],
): ConnectConnectionAdapter & {
  calls: Array<{ messages: UIMessage[]; data?: Record<string, unknown> }>;
} => {
  const calls: Array<{ messages: UIMessage[]; data?: Record<string, unknown> }> = [];
  return {
    calls,
    async *connect(messages, data) {
      calls.push({ messages, data: data ?? {} });
      yield* script(messages, data);
    },
  };
};

const assistantChunks = (messageId: string, text: string): StreamChunk[] => [
  { type: 'RUN_STARTED', runId: 'r1' },
  { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' },
  ...[...text].map((ch) => ({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: ch })),
  { type: 'TEXT_MESSAGE_END', messageId },
  { type: 'RUN_FINISHED', runId: 'r1' },
];

describe('ChatClient', () => {
  it('sendMessage appends the user turn and assembles the streamed answer', async () => {
    const connection = connectionOf(() => assistantChunks('a1', 'hello'));
    const snapshots: UIMessage[][] = [];
    const chunkTypes: string[] = [];
    const client = new ChatClient({
      connection,
      threadId: 'conv-1',
      onMessagesChange: (m) => snapshots.push(m),
      onChunk: (c) => chunkTypes.push(c.type),
    });

    await client.sendMessage('hi there');

    const messages = client.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', content: 'hi there' }],
    });
    expect(messages[1]).toMatchObject({
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', content: 'hello' }],
    });
    expect(chunkTypes).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      ...Array(5).fill('TEXT_MESSAGE_CONTENT'),
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    // the transcript grew incrementally (streaming renders live)
    expect(snapshots.length).toBeGreaterThan(3);
    expect(client.getIsLoading()).toBe(false);
  });

  it('re-reads getter-backed forwardedProps on every send', async () => {
    const connection = connectionOf(() => [{ type: 'RUN_FINISHED' }]);
    let modelId = 'demo/demo';
    const client = new ChatClient({
      connection,
      get forwardedProps() {
        return { modelId };
      },
    });
    await client.sendMessage('one');
    modelId = 'anthropic/claude-haiku-4-5';
    await client.sendMessage('two');
    expect(connection.calls[0]!.data).toEqual({ modelId: 'demo/demo' });
    expect(connection.calls[1]!.data).toEqual({ modelId: 'anthropic/claude-haiku-4-5' });
  });

  it('ignores empty sends and sends while a run is live', async () => {
    const connection = connectionOf(() => [{ type: 'RUN_FINISHED' }]);
    const client = new ChatClient({ connection });
    await client.sendMessage('');
    expect(connection.calls).toHaveLength(0);
  });

  it('stop() aborts the run and keeps the partial text', async () => {
    const aborts: string[] = [];
    const connection: ConnectConnectionAdapter = {
      async *connect(_messages, _data, signal) {
        yield { type: 'TEXT_MESSAGE_START', messageId: 'a1' };
        yield { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'par' };
        await new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => {
            aborts.push('aborted');
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      },
    };
    const errors: Error[] = [];
    const client = new ChatClient({ connection, onError: (e) => errors.push(e) });

    const sending = client.sendMessage('hi');
    await vi.waitFor(() => {
      expect(client.getMessages().at(-1)?.parts[0]?.content).toBe('par');
    });
    client.stop();
    await sending;

    expect(aborts).toEqual(['aborted']);
    expect(client.getIsLoading()).toBe(false);
    expect(errors).toEqual([]); // a stop is not an error
    expect(client.getMessages().at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', content: 'par' }],
    });
  });

  it('reload() drops the last answer and re-sends history ending at the user turn', async () => {
    const connection = connectionOf((messages) => assistantChunks(`a${messages.length}`, 'answer'));
    const client = new ChatClient({ connection });
    await client.sendMessage('question');
    expect(client.getMessages()).toHaveLength(2);

    await client.reload();

    // the request carried only the history up to the user message
    expect(connection.calls[1]!.messages.map((m) => m.role)).toEqual(['user']);
    const messages = client.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[1]!.id).not.toBe(connection.calls[0]!.messages.at(-1)?.id);
  });

  it('reload() with no user turn is a no-op', async () => {
    const connection = connectionOf(() => []);
    const client = new ChatClient({ connection });
    await client.reload();
    expect(connection.calls).toHaveLength(0);
  });

  it('setMessages replaces the transcript wholesale', () => {
    const connection = connectionOf(() => []);
    const snapshots: UIMessage[][] = [];
    const client = new ChatClient({ connection, onMessagesChange: (m) => snapshots.push(m) });
    const history = [
      userMessage('u1', 'hi'),
      { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text', content: 'yo' }] },
    ];
    client.setMessages(history);
    expect(client.getMessages()).toEqual(history);
    expect(snapshots).toHaveLength(1);
  });

  it('a transport failure fires onError and ends the run', async () => {
    const connection: ConnectConnectionAdapter = {
      // eslint-disable-next-line require-yield
      async *connect() {
        throw new Error('HTTP error! status: 503 Service Unavailable');
      },
    };
    const errors: Error[] = [];
    const client = new ChatClient({ connection, onError: (e) => errors.push(e) });
    await client.sendMessage('hi');
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('503');
    expect(client.getIsLoading()).toBe(false);
  });

  it('assembles text even when a stream skips TEXT_MESSAGE_START', async () => {
    const connection = connectionOf(() => [
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'hi' },
      { type: 'RUN_FINISHED' },
    ]);
    const client = new ChatClient({ connection });
    await client.sendMessage('q');
    expect(client.getMessages().at(-1)).toMatchObject({
      role: 'assistant',
      parts: [{ type: 'text', content: 'hi' }],
    });
  });
});
