import { describe, expect, it, vi } from 'vitest';
import { fetchServerSentEvents } from '@crisp/ai/client';
import { chatRequestSchema } from '@crisp/runs';

/**
 * The client–server wire pin: the body @crisp/ai's connection adapter
 * actually POSTs must parse against the schema the chat route validates
 * with. It lives here, not in either lib — the composition root is the only
 * place allowed to see both sides of the wire, which also keeps @crisp/ai
 * free of any dependency on the runs slice.
 */
describe('chat wire contract', () => {
  it("the @crisp/ai client body satisfies the runs slice's chatRequestSchema", async () => {
    const mock = vi.fn(
      async () => new Response('data: {"type":"RUN_FINISHED"}\n\n', { status: 200 }),
    );
    vi.stubGlobal('fetch', mock);
    try {
      const stream = fetchServerSentEvents('/api/chat').connect(
        [{ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'hi' }] }],
        { modelId: 'demo/demo', apiKey: 'user-key' },
        undefined,
        { threadId: 'conv-1' },
      );
      for await (const _ of stream) void _;
    } finally {
      vi.unstubAllGlobals();
    }

    const [, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = chatRequestSchema.safeParse(JSON.parse(init.body as string));
    expect(parsed.success).toBe(true);
  });
});
