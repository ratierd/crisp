import { describe, expect, it } from 'vitest';
import { toServerSentEventsResponse } from './sse-response';
import type { StreamChunk } from './types';

const streamOf = (chunks: StreamChunk[], error?: Error) =>
  (async function* () {
    yield* chunks;
    if (error) throw error;
  })();

describe('toServerSentEventsResponse', () => {
  it('sets the SSE headers and lets caller headers win', async () => {
    const response = toServerSentEventsResponse(streamOf([]), { headers: { 'x-run-id': 'run-1' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('x-run-id')).toBe('run-1');
  });

  it('frames every chunk as `data: <json>` with a blank-line separator', async () => {
    const response = toServerSentEventsResponse(
      streamOf([
        { type: 'RUN_STARTED', runId: 'r1' },
        { type: 'TEXT_MESSAGE_CONTENT', delta: 'hi' },
      ]),
    );
    const body = await response.text();
    expect(body).toBe(
      'data: {"type":"RUN_STARTED","runId":"r1"}\n\ndata: {"type":"TEXT_MESSAGE_CONTENT","delta":"hi"}\n\n',
    );
  });

  it('a stream failure surfaces in-band as a final RUN_ERROR frame', async () => {
    const response = toServerSentEventsResponse(
      streamOf([{ type: 'RUN_STARTED' }], new Error('redis gone')),
    );
    const frames = (await response.text()).split('\n\n').filter(Boolean);
    const last = JSON.parse(frames.at(-1)!.slice('data: '.length)) as StreamChunk;
    expect(last.type).toBe('RUN_ERROR');
    expect(last.message).toBe('redis gone');
  });
});
