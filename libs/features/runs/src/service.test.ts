import { describe, expect, it } from 'vitest';
import type { Message } from '@crisp/conversations/contracts';
import type { Model } from '@crisp/models/contracts';
import type { RunEvent } from './contracts';
import { RunService } from './service';
import {
  FakeMessageStore,
  FakeModelGateway,
  FakeRunStreamStore,
  defaultRunEvents,
} from './testing';

const demoModel: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

const userMessage = (content: string): Message => ({
  id: 'user-1',
  role: 'user',
  parts: [{ type: 'text', content }],
  createdAt: new Date(0).toISOString(),
});

const setup = (gateway: FakeModelGateway) => {
  const store = new FakeMessageStore();
  const runStreams = new FakeRunStreamStore();
  const service = new RunService({ gateway, messages: store, runStreams });
  return { store, runStreams, service };
};

const collect = async (events: AsyncIterable<RunEvent>) => {
  const seen: RunEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
};

describe('RunService.execute', () => {
  it('streams gateway events, tees them into the store, and persists both messages', async () => {
    const gateway = new FakeModelGateway({
      events: defaultRunEvents('r', 'Hello streaming world'),
    });
    const { store, runStreams, service } = setup(gateway);

    const seen = await collect(
      service.execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [{ role: 'user', content: 'hi' }],
        userMessage: userMessage('hi'),
      }),
    );

    expect(seen.map((e) => e.type)).toEqual([
      'RUN_STARTED',
      'TEXT_MESSAGE_START',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_CONTENT',
      'TEXT_MESSAGE_END',
      'RUN_FINISHED',
    ]);

    const messages = store.messages.get('c1')!;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.parts[0]!.content).toBe('Hello streaming world');
    expect(messages[1]!.modelId).toBe('demo/demo');
    expect(messages[1]!.stats).toBeDefined();
    expect(messages[1]!.stats!.durationMs).toBeGreaterThanOrEqual(messages[1]!.stats!.ttftMs);
    expect(messages[1]!.stoppedEarly).toBeUndefined();

    const [runId] = [...runStreams.events.keys()];
    expect(runStreams.events.get(runId!)).toHaveLength(seen.length);
    expect(runStreams.finished.has(runId!)).toBe(true);
  });

  it('does not persist an assistant message when the run errors', async () => {
    const events: RunEvent[] = [
      { type: 'RUN_STARTED', runId: 'r' },
      { type: 'RUN_ERROR', runId: 'r', code: 'rate_limited', message: 'slow down' },
    ];
    const gateway = new FakeModelGateway({ events });
    const { store, runStreams, service } = setup(gateway);

    const seen = await collect(
      service.execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [],
        userMessage: userMessage('hi'),
      }),
    );

    expect(seen.at(-1)!.type).toBe('RUN_ERROR');
    const messages = store.messages.get('c1')!;
    expect(messages).toHaveLength(1); // only the user message
    expect(runStreams.finished.has('run-1')).toBe(true);
  });

  it('stops forwarding events after RUN_ERROR', async () => {
    const events: RunEvent[] = [
      { type: 'RUN_ERROR', runId: 'r', code: 'provider_unavailable', message: 'down' },
      { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'should not appear' },
    ];
    const gateway = new FakeModelGateway({ events });
    const { service } = setup(gateway);

    const seen = await collect(
      service.execute({ conversationId: 'c1', runId: 'run-1', model: demoModel, history: [] }),
    );
    expect(seen).toHaveLength(1);
  });

  it('synthesizes a RUN_ERROR with kind unknown when the gateway throws', async () => {
    const gateway = new FakeModelGateway({
      events: defaultRunEvents('r', 'partial answer here'),
      throwAfter: 3,
      error: new Error('socket reset'),
    });
    const { store, runStreams, service } = setup(gateway);

    const seen = await collect(
      service.execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [],
        userMessage: userMessage('hi'),
      }),
    );

    const last = seen.at(-1)!;
    expect(last.type).toBe('RUN_ERROR');
    expect(last.code).toBe('unknown');
    expect(last.message).toBe('socket reset');
    expect(last.provider).toBe('the demo provider');

    // failed runs keep only the user message
    expect(store.messages.get('c1')!).toHaveLength(1);
    const [runId] = [...runStreams.events.keys()];
    expect(runStreams.finished.has(runId!)).toBe(true);
  });

  it('persists a partial assistant message flagged stoppedEarly on abort', async () => {
    const controller = new AbortController();
    const gateway = new FakeModelGateway({
      events: defaultRunEvents('r', 'one two three four five six'),
      delayMs: 5,
    });
    const { store, service } = setup(gateway);

    const iterator = service
      .execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [],
        userMessage: userMessage('count'),
        signal: controller.signal,
      })
      [Symbol.asyncIterator]();

    // consume RUN_STARTED, TEXT_MESSAGE_START and two deltas, then abort
    for (let i = 0; i < 4; i++) await iterator.next();
    controller.abort();
    let done = false;
    while (!done) ({ done = false } = await iterator.next());

    const messages = store.messages.get('c1')!;
    expect(messages).toHaveLength(2);
    const assistant = messages[1]!;
    expect(assistant.stoppedEarly).toBe(true);
    expect(assistant.parts[0]!.content.length).toBeGreaterThan(0);
    expect(assistant.parts[0]!.content.length).toBeLessThan('one two three four five six'.length);
  });

  it('persists the exchange even when the stream store dies mid-run', async () => {
    const gateway = new FakeModelGateway({
      events: defaultRunEvents('r', 'answer that must survive redis dying'),
    });
    const store = new FakeMessageStore();
    const runStreams = new FakeRunStreamStore();
    // The store starts failing after the second event — a Redis outage mid-run.
    let appended = 0;
    runStreams.append = async () => {
      appended += 1;
      if (appended > 2) throw new Error('redis connection lost');
    };
    runStreams.markFinished = async () => {
      throw new Error('redis connection lost');
    };
    const service = new RunService({ gateway, messages: store, runStreams });

    const seen = await collect(
      service.execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [{ role: 'user', content: 'hi' }],
        userMessage: userMessage('hi'),
      }),
    );

    // the full gateway stream was still consumed…
    expect(seen.at(-1)!.type).toBe('RUN_FINISHED');
    // …and the exchange landed in the message store despite the dead stream
    const messages = store.messages.get('c1')!;
    expect(messages).toHaveLength(2);
    expect(messages[1]!.parts[0]!.content).toBe('answer that must survive redis dying');
    expect(messages[1]!.stoppedEarly).toBeUndefined();
  });

  it('persists nothing extra when aborted before the first token', async () => {
    const controller = new AbortController();
    controller.abort();
    const gateway = new FakeModelGateway({
      events: defaultRunEvents('r', 'never seen'),
      delayMs: 2,
    });
    const { store, service } = setup(gateway);

    await collect(
      service.execute({
        conversationId: 'c1',
        runId: 'run-1',
        model: demoModel,
        history: [],
        userMessage: userMessage('hi'),
        signal: controller.signal,
      }),
    );

    expect(store.messages.get('c1')!).toHaveLength(1);
  });
});
