import { describe, expect, it } from 'vitest';
import { chat } from './chat';
import type { AdapterEvent, AdapterRequest, StreamChunk, TextAdapter } from './types';

const adapterOf = (
  events: AdapterEvent[] | ((request: AdapterRequest) => AsyncIterable<AdapterEvent>),
): TextAdapter & { requests: AdapterRequest[] } => {
  const requests: AdapterRequest[] = [];
  return {
    name: 'fake',
    model: 'fake-model',
    requests,
    async *chatStream(request) {
      requests.push(request);
      if (typeof events === 'function') {
        yield* events(request);
        return;
      }
      yield* events;
    },
  };
};

const collect = async (stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> => {
  const out: StreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
};

const messages = [{ role: 'user' as const, content: 'hi' }];

describe('chat event envelope', () => {
  it('emits the canonical AG-UI sequence for a text run', async () => {
    const adapter = adapterOf([
      { type: 'text-delta', delta: 'hel' },
      { type: 'text-delta', delta: 'lo' },
      { type: 'finish', finishReason: 'stop', usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 } },
    ]);
    const events = await collect(chat({ adapter, messages, threadId: 'conv-1', runId: 'run-1' }));

    expect(events.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);
    expect(events[0]).toMatchObject({ runId: 'run-1', threadId: 'conv-1', model: 'fake-model' });
    const messageId = events[1]!.messageId;
    expect(typeof messageId).toBe('string');
    expect(events[1]).toMatchObject({ role: 'assistant' });
    expect(events[2]).toMatchObject({ messageId, delta: 'hel' });
    expect(events[3]).toMatchObject({ messageId, delta: 'lo' });
    expect(events[4]).toMatchObject({ messageId });
    expect(events[5]).toMatchObject({
      runId: 'run-1',
      threadId: 'conv-1',
      finishReason: 'stop',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
    });
    expect(typeof events[5]!.timestamp).toBe('number');
  });

  it('mints runId and threadId when the caller brings none', async () => {
    const adapter = adapterOf([{ type: 'finish' }]);
    const events = await collect(chat({ adapter, messages }));
    expect(typeof events[0]!.runId).toBe('string');
    expect(typeof events[0]!.threadId).toBe('string');
  });

  it('forwards messages, systemPrompts and the abort signal to the adapter', async () => {
    const adapter = adapterOf([{ type: 'finish' }]);
    const abortController = new AbortController();
    await collect(chat({ adapter, messages, systemPrompts: ['be terse'], abortController }));
    expect(adapter.requests[0]).toMatchObject({ messages, systemPrompts: ['be terse'] });
    expect(adapter.requests[0]!.signal).toBe(abortController.signal);
  });

  it('omits systemPrompts from the adapter request when there are none', async () => {
    const adapter = adapterOf([{ type: 'finish' }]);
    await collect(chat({ adapter, messages }));
    expect('systemPrompts' in adapter.requests[0]!).toBe(false);
  });
});

describe('chat edge cases', () => {
  it('never announces a message for a run that produced no text', async () => {
    const adapter = adapterOf([{ type: 'finish', finishReason: 'stop' }]);
    const events = await collect(chat({ adapter, messages }));
    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'RUN_FINISHED']);
  });

  it('a provider throw becomes a terminal RUN_ERROR with the raw message and code', async () => {
    const failing = Object.assign(new Error('anthropic request failed with status 429 Too Many Requests'), {
      code: 'rate_limit_error',
    });
    const adapter = adapterOf(async function* () {
      yield { type: 'text-delta', delta: 'par' } as AdapterEvent;
      throw failing;
    });
    const events = await collect(chat({ adapter, messages, runId: 'run-1', threadId: 'conv-1' }));

    expect(events.map((e) => e.type)).toEqual(['RUN_STARTED', 'TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'RUN_ERROR']);
    expect(events.at(-1)).toMatchObject({
      runId: 'run-1',
      threadId: 'conv-1',
      message: 'anthropic request failed with status 429 Too Many Requests',
      code: 'rate_limit_error',
    });
  });

  it('an abort rethrows so callers can tell a stop from a failure', async () => {
    const abortController = new AbortController();
    const adapter = adapterOf(async function* () {
      yield { type: 'text-delta', delta: 'par' } as AdapterEvent;
      abortController.abort();
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    await expect(collect(chat({ adapter, messages, abortController }))).rejects.toThrow('aborted');
  });
});
