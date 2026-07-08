/**
 * Line-oriented readers for the two streaming wire formats providers use:
 * SSE (`data: <payload>` frames) and NDJSON (one JSON document per line).
 */

/** Yields complete lines from a byte stream, buffering partial trailers. */
export async function* streamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        yield buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer.length > 0) yield buffer;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Yields the payload of every `data:` SSE line. Comments and `event:`/`id:`/
 * `retry:` lines are skipped; framing blank lines fall out naturally. This
 * reads one payload per data line — every provider we speak to (and our own
 * server) emits single-line data frames.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  for await (const line of streamLines(body)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload.length > 0) yield payload;
  }
}
