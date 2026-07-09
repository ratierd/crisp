import { afterEach, describe, expect, it, vi } from 'vitest';
import { replayRun } from './api';

/**
 * replayRun is the hand-rolled SSE reader behind mid-stream resume
 * (ADR-0001): after a refresh the client replays a live Run's backlog and
 * tails it. These tests feed it byte streams with hostile chunk boundaries.
 */
const encoder = new TextEncoder();

const sseResponse = (chunks: Array<string | Uint8Array>, init: ResponseInit = {}): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        }
        controller.close();
      },
    }),
    { status: 200, ...init },
  );

const stubFetch = (response: Response) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

const collect = async (runId = 'run-9', signal?: AbortSignal) => {
  const events = [];
  for await (const event of replayRun(runId, signal)) events.push(event);
  return events;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('replayRun', () => {
  it('requests the replay endpoint for the run', async () => {
    const fetchMock = stubFetch(sseResponse(['data: {"type":"RUN_FINISHED"}\n\n']));
    await collect('run-42');
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-42/events', expect.anything());
  });

  it('yields one event per data frame, in order', async () => {
    stubFetch(sseResponse(['data: {"type":"A"}\n\ndata: {"type":"B","delta":"x"}\n\n']));
    expect(await collect()).toEqual([{ type: 'A' }, { type: 'B', delta: 'x' }]);
  });

  it('reassembles a frame split across arbitrary chunk boundaries', async () => {
    stubFetch(sseResponse(['data: {"ty', 'pe":"A"', '}\n', '\ndata: {"type":"B"}\n\n']));
    expect(await collect()).toEqual([{ type: 'A' }, { type: 'B' }]);
  });

  it('survives a chunk boundary inside a multi-byte UTF-8 character', async () => {
    const bytes = encoder.encode('data: {"type":"A","delta":"héllo"}\n\n');
    const splitAt = 20; // inside the é sequence
    stubFetch(sseResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)]));
    expect(await collect()).toEqual([{ type: 'A', delta: 'héllo' }]);
  });

  it('accepts data lines with or without the space after the colon', async () => {
    stubFetch(sseResponse(['data:{"type":"A"}\n\n']));
    expect(await collect()).toEqual([{ type: 'A' }]);
  });

  it('ignores [DONE], empty payloads, comments and non-data lines', async () => {
    stubFetch(
      sseResponse([
        'event: message\ndata: {"type":"A"}\n\n',
        ':keepalive\n\n',
        'data:\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    expect(await collect()).toEqual([{ type: 'A' }]);
  });

  it('does not yield a trailing frame that was never terminated', async () => {
    // SSE frames end with a blank line; a stream that dies mid-frame must
    // not surface a half-parsed event.
    stubFetch(sseResponse(['data: {"type":"A"}\n\ndata: {"type":"TRUNCATED"']));
    expect(await collect()).toEqual([{ type: 'A' }]);
  });

  it('throws on a non-ok response instead of yielding nothing', async () => {
    stubFetch(new Response('gone', { status: 404 }));
    await expect(collect()).rejects.toThrow('replay failed: 404');
  });

  it('forwards the abort signal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = stubFetch(sseResponse(['data: {"type":"A"}\n\n']));
    await collect('run-9', controller.signal);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-9/events', { signal: controller.signal });
  });
});
