import { streamLines } from '../core/lines';
import { ProviderError, throwOnHttpError } from '../core/provider-error';
import type { AdapterEvent, AdapterRequest, TextAdapter } from '../core/types';

interface OllamaChunk {
  message?: { content?: string };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

/**
 * Ollama `/api/chat` text adapter, browser-safe so a page can run it against
 * the user's own daemon. The response is NDJSON: one chunk
 * per line, a final `done: true` line carrying token counts.
 */
export const createOllamaChat = (model: string, baseUrl = 'http://localhost:11434'): TextAdapter => ({
  name: 'ollama',
  model,
  async *chatStream({ messages, systemPrompts, signal }: AdapterRequest): AsyncIterable<AdapterEvent> {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          ...(systemPrompts && systemPrompts.length > 0 ? [{ role: 'system', content: systemPrompts.join('\n') }] : []),
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
      }),
      ...(signal ? { signal } : {}),
    });
    await throwOnHttpError(response, 'ollama');
    if (!response.body) throw new ProviderError('ollama returned no response body.');

    for await (const line of streamLines(response.body)) {
      if (line.trim().length === 0) continue;
      const chunk = JSON.parse(line) as OllamaChunk;
      if (typeof chunk.error === 'string') throw new ProviderError(chunk.error);
      if (typeof chunk.message?.content === 'string' && chunk.message.content.length > 0) {
        yield { type: 'text-delta', delta: chunk.message.content };
      }
      if (chunk.done) {
        const promptTokens = chunk.prompt_eval_count ?? 0;
        const completionTokens = chunk.eval_count ?? 0;
        yield {
          type: 'finish',
          finishReason: chunk.done_reason ?? 'stop',
          ...(promptTokens > 0 || completionTokens > 0
            ? { usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } }
            : {}),
        };
        return;
      }
    }
    yield { type: 'finish' };
  },
});
