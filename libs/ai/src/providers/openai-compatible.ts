import { sseData } from '../core/lines';
import { ProviderError, throwOnHttpError } from '../core/provider-error';
import type { AdapterEvent, AdapterRequest, TextAdapter, TokenUsage } from '../core/types';

export interface OpenaiCompatibleConfig {
  /** Provider name for diagnostics (e.g. `openrouter`). */
  name?: string;
  /** API root, e.g. `https://openrouter.ai/api/v1`. */
  baseURL: string;
  apiKey: string;
  /** Only the chat-completions dialect is spoken here. */
  api?: 'chat-completions';
  /** Extra request headers (e.g. OpenRouter attribution). */
  defaultHeaders?: Record<string, string>;
}

interface CompletionChunk {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
  error?: { message?: string; code?: string | number } | string;
}

/**
 * Text adapter for any OpenAI-compatible chat-completions endpoint
 * (OpenRouter, and OpenAI itself via `@crisp/ai/openai`). Streams SSE chunks,
 * asking for the final usage frame via `stream_options.include_usage`.
 */
export const openaiCompatibleText = (model: string, config: OpenaiCompatibleConfig): TextAdapter => {
  const name = config.name ?? 'openai-compatible';
  return {
    name,
    model,
    async *chatStream({ messages, systemPrompts, signal }: AdapterRequest): AsyncIterable<AdapterEvent> {
      const response = await fetch(`${config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
          ...config.defaultHeaders,
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemPrompts && systemPrompts.length > 0 ? [{ role: 'system', content: systemPrompts.join('\n') }] : []),
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
          stream_options: { include_usage: true },
        }),
        ...(signal ? { signal } : {}),
      });
      await throwOnHttpError(response, name);
      if (!response.body) throw new ProviderError(`${name} returned no response body.`);

      let finishReason: string | undefined;
      let usage: TokenUsage | undefined;
      for await (const payload of sseData(response.body)) {
        if (payload === '[DONE]') break;
        const chunk = JSON.parse(payload) as CompletionChunk;
        // Some compatible providers (OpenRouter among them) report mid-stream
        // failures as an `error` field on an otherwise ordinary chunk.
        if (chunk.error) {
          const message = typeof chunk.error === 'string' ? chunk.error : (chunk.error.message ?? 'The provider reported an error.');
          const code = typeof chunk.error === 'object' && chunk.error.code !== undefined ? String(chunk.error.code) : undefined;
          throw new ProviderError(message, code);
        }
        const choice = chunk.choices?.[0];
        if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0) {
          yield { type: 'text-delta', delta: choice.delta.content };
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          const prompt = chunk.usage.prompt_tokens ?? 0;
          const completion = chunk.usage.completion_tokens ?? 0;
          usage = {
            promptTokens: prompt,
            completionTokens: completion,
            totalTokens: chunk.usage.total_tokens ?? prompt + completion,
          };
        }
      }
      yield {
        type: 'finish',
        ...(finishReason !== undefined ? { finishReason } : {}),
        ...(usage !== undefined ? { usage } : {}),
      };
    },
  };
};
