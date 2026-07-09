import { describe, expect, it } from 'vitest';
import type { Client } from 'langsmith';
import type { ModelGateway, RunEvent, StartRunOptions } from '@crisp/domain';
import { LangsmithTracingGateway } from '../src/infra/langsmith-tracing-gateway';

const MODEL = {
  id: 'anthropic/claude-sonnet-4-6',
  displayName: 'Claude Sonnet 4.6',
  provider: 'Anthropic',
  provenance: 'remote',
  available: true,
} as const;

const options = (overrides: Partial<StartRunOptions> = {}): StartRunOptions => ({
  model: MODEL,
  messages: [{ role: 'user', content: 'hi' }],
  runId: '018f6f4e-0000-7000-8000-000000000001',
  threadId: 'conv-42',
  ...overrides,
});

/** Minimal structural fake for the two Client methods RunTree uses. */
const fakeClient = () => {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const client = {
    createRun: async (run: Record<string, unknown>) => {
      created.push(run);
    },
    updateRun: async (id: string, payload: Record<string, unknown>) => {
      updated.push({ id, payload });
    },
  } as unknown as Client;
  return { client, created, updated };
};

const gatewayOf = (events: RunEvent[], failAt?: number): ModelGateway => ({
  async *startRun(opts: StartRunOptions) {
    for (const [index, event] of events.entries()) {
      if (index === failAt) throw new Error('provider exploded');
      if (opts.signal?.aborted) throw new DOMException('stopped', 'AbortError');
      yield event;
    }
  },
});

const drain = async (iterable: AsyncIterable<RunEvent>) => {
  const seen: RunEvent[] = [];
  for await (const event of iterable) seen.push(event);
  return seen;
};

describe('LangsmithTracingGateway', () => {
  it('mirrors a completed run: id = runId, thread metadata, text and usage outputs', async () => {
    const { client, created, updated } = fakeClient();
    const events: RunEvent[] = [
      { type: 'RUN_STARTED' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'Hello ' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'world' },
      { type: 'RUN_FINISHED', usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17 } },
    ];
    const gateway = new LangsmithTracingGateway(gatewayOf(events), client);

    const seen = await drain(gateway.startRun(options()));

    expect(seen).toEqual(events); // events pass through untouched
    expect(created).toHaveLength(1);
    expect(created[0]!.id).toBe('018f6f4e-0000-7000-8000-000000000001');
    expect(created[0]!.name).toBe('anthropic/claude-sonnet-4-6');
    expect(created[0]!.run_type).toBe('llm');
    expect(created[0]!.inputs).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
    const metadata = (created[0]!.extra as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.thread_id).toBe('conv-42');
    expect(metadata.ls_provider).toBe('anthropic');
    expect(metadata.ls_model_name).toBe('claude-sonnet-4-6');

    expect(updated).toHaveLength(1);
    const payload = updated[0]!.payload;
    expect(payload.outputs).toEqual({
      message: { role: 'assistant', content: 'Hello world' },
      usage_metadata: { input_tokens: 12, output_tokens: 5, total_tokens: 17 },
    });
    expect(payload.error).toBeUndefined();
    const endMetadata = (payload.extra as { metadata: Record<string, unknown> }).metadata;
    expect(endMetadata.outcome).toBe('completed');
  });

  it('marks a RUN_ERROR run failed even when the consumer stops reading', async () => {
    const { client, updated } = fakeClient();
    const events: RunEvent[] = [
      { type: 'RUN_STARTED' },
      { type: 'RUN_ERROR', message: 'rate limited', code: 'rate_limited' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'never read' },
    ];
    const gateway = new LangsmithTracingGateway(gatewayOf(events), client);

    // RunService breaks out of the loop right after RUN_ERROR
    for await (const event of gateway.startRun(options())) {
      if (event.type === 'RUN_ERROR') break;
    }

    expect(updated).toHaveLength(1);
    expect(updated[0]!.payload.error).toBe('rate limited');
    const metadata = (updated[0]!.payload.extra as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.outcome).toBe('failed');
  });

  it('marks an aborted run stopped, keeps partial text, and rethrows', async () => {
    const { client, updated } = fakeClient();
    const controller = new AbortController();
    const inner: ModelGateway = {
      async *startRun() {
        yield { type: 'TEXT_MESSAGE_CONTENT', delta: 'partial' };
        controller.abort();
        throw new DOMException('stopped', 'AbortError');
      },
    };
    const gateway = new LangsmithTracingGateway(inner, client);

    await expect(drain(gateway.startRun(options({ signal: controller.signal })))).rejects.toThrow(
      'stopped',
    );

    expect(updated).toHaveLength(1);
    const payload = updated[0]!.payload;
    expect(payload.error).toBeUndefined();
    expect((payload.outputs as { message: { content: string } }).message.content).toBe('partial');
    const metadata = (payload.extra as { metadata: Record<string, unknown> }).metadata;
    expect(metadata.outcome).toBe('stopped');
  });

  it('marks an unexpected provider throw failed', async () => {
    const { client, updated } = fakeClient();
    const events: RunEvent[] = [
      { type: 'RUN_STARTED' },
      { type: 'TEXT_MESSAGE_CONTENT', delta: 'x' },
    ];
    const gateway = new LangsmithTracingGateway(gatewayOf(events, 1), client);

    await expect(drain(gateway.startRun(options()))).rejects.toThrow('provider exploded');

    expect(updated).toHaveLength(1);
    expect(updated[0]!.payload.error).toBe('provider exploded');
  });

  it('never disturbs the stream when LangSmith is down', async () => {
    const client = {
      createRun: async () => {
        throw new Error('langsmith unreachable');
      },
      updateRun: async () => {
        throw new Error('langsmith unreachable');
      },
    } as unknown as Client;
    const events: RunEvent[] = [{ type: 'RUN_STARTED' }, { type: 'RUN_FINISHED' }];
    const gateway = new LangsmithTracingGateway(gatewayOf(events), client);

    const seen = await drain(gateway.startRun(options()));
    expect(seen).toEqual(events);
  });
});
