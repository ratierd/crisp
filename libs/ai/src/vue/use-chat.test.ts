import { describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { useChat } from './index';
import type { ConnectConnectionAdapter, StreamChunk, UIMessage } from './index';

const connectionOf = (
  chunks: StreamChunk[],
): ConnectConnectionAdapter & { data: Array<Record<string, unknown> | undefined> } => {
  const data: Array<Record<string, unknown> | undefined> = [];
  return {
    data,
    async *connect(_messages, forwarded) {
      data.push(forwarded);
      yield* chunks;
    },
  };
};

describe('useChat', () => {
  it('exposes messages and isLoading as refs the stream updates', async () => {
    const chat = useChat({
      connection: connectionOf([
        { type: 'TEXT_MESSAGE_START', messageId: 'a1' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'hello' },
        { type: 'TEXT_MESSAGE_END', messageId: 'a1' },
        { type: 'RUN_FINISHED' },
      ]),
      threadId: 'conv-1',
    });

    expect(chat.messages.value).toEqual([]);
    expect(chat.isLoading.value).toBe(false);

    await chat.sendMessage('hi');

    expect(chat.messages.value.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(chat.messages.value[1]!.parts[0]!.content).toBe('hello');
    expect(chat.isLoading.value).toBe(false);
  });

  it('the forwardedProps getter on the options object is read per send', async () => {
    const connection = connectionOf([{ type: 'RUN_FINISHED' }]);
    let key: string | undefined;
    const chat = useChat({
      connection,
      get forwardedProps() {
        return { modelId: 'demo/demo', ...(key ? { apiKey: key } : {}) };
      },
    });
    await chat.sendMessage('one');
    key = 'user-key';
    await chat.sendMessage('two');
    expect(connection.data[0]).toEqual({ modelId: 'demo/demo' });
    expect(connection.data[1]).toEqual({ modelId: 'demo/demo', apiKey: 'user-key' });
  });

  it('setMessages seeds the transcript (loading a persisted conversation)', () => {
    const chat = useChat({ connection: connectionOf([]) });
    const history: UIMessage[] = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', content: 'q' }], createdAt: new Date() },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'text', content: 'a' }],
        createdAt: new Date(),
      },
    ];
    chat.setMessages(history);
    expect(chat.messages.value).toEqual(history);
  });

  it('scope disposal stops the in-flight run', async () => {
    let aborted = false;
    const connection: ConnectConnectionAdapter = {
      async *connect(_messages, _data, signal) {
        yield { type: 'TEXT_MESSAGE_START', messageId: 'a1' };
        await new Promise<never>((_, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      },
    };
    const scope = effectScope();
    const chat = scope.run(() => useChat({ connection }))!;
    const sending = chat.sendMessage('hi');
    // wait for the run to be live (the connection listening) before disposing
    await vi.waitFor(() => {
      expect(chat.messages.value.at(-1)?.role).toBe('assistant');
    });
    scope.stop();
    await sending;
    expect(aborted).toBe(true);
  });
});
