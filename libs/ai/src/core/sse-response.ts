import type { StreamChunk } from './types';

export interface SseResponseInit {
  /** Extra headers; they win over the SSE defaults on collision. */
  headers?: Record<string, string>;
  status?: number;
}

/**
 * Wraps an AG-UI event stream in an HTTP SSE Response: one
 * `data: <json>\n\n` frame per event, no `[DONE]` sentinel — the stream
 * closing is the terminator. A stream that throws mid-flight emits one final
 * RUN_ERROR frame so the client hears about the failure in-band instead of a
 * truncated connection.
 */
export const toServerSentEventsResponse = (stream: AsyncIterable<StreamChunk>, init: SseResponseInit = {}): Response => {
  const headers = new Headers({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  if (init.headers) {
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  }

  const encoder = new TextEncoder();
  const frame = (chunk: StreamChunk) => encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of stream) controller.enqueue(frame(chunk));
      } catch (error) {
        controller.enqueue(
          frame({
            type: 'RUN_ERROR',
            message: error instanceof Error ? error.message : String(error),
            timestamp: Date.now(),
          }),
        );
      }
      controller.close();
    },
  });

  return new Response(body, { status: init.status ?? 200, headers });
};
