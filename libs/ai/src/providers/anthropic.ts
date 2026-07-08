import { sseData } from '../core/lines';
import { ProviderError, throwOnHttpError } from '../core/provider-error';
import type { AdapterEvent, AdapterRequest, TextAdapter } from '../core/types';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
/** Ceiling, not a target — generation stops at the model's natural end. */
const MAX_TOKENS = 8192;

/** Anthropic stop reasons, translated to the finish vocabulary we emit. */
const finishReasonOf = (stopReason: string | undefined): string | undefined => {
  if (stopReason === undefined) return undefined;
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop';
  if (stopReason === 'max_tokens') return 'length';
  return stopReason;
};

interface AnthropicStreamEvent {
  type: string;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  delta?: { type?: string; text?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  error?: { type?: string; message?: string };
}

/**
 * Anthropic Messages API text adapter. Speaks the streaming SSE dialect:
 * `message_start` carries prompt usage, `content_block_delta`/`text_delta`
 * the tokens, `message_delta` completion usage and the stop reason.
 */
export const createAnthropicChat = (model: string, apiKey: string): TextAdapter => ({
  name: 'anthropic',
  model,
  async *chatStream({ messages, systemPrompts, signal }: AdapterRequest): AsyncIterable<AdapterEvent> {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_TOKENS,
        ...(systemPrompts && systemPrompts.length > 0 ? { system: systemPrompts.join('\n') } : {}),
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      }),
      ...(signal ? { signal } : {}),
    });
    await throwOnHttpError(response, 'anthropic');
    if (!response.body) throw new ProviderError('anthropic returned no response body.');

    let promptTokens = 0;
    let completionTokens = 0;
    let stopReason: string | undefined;
    for await (const payload of sseData(response.body)) {
      const event = JSON.parse(payload) as AnthropicStreamEvent;
      switch (event.type) {
        case 'message_start':
          promptTokens = event.message?.usage?.input_tokens ?? 0;
          completionTokens = event.message?.usage?.output_tokens ?? 0;
          break;
        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string' && event.delta.text.length > 0) {
            yield { type: 'text-delta', delta: event.delta.text };
          }
          break;
        case 'message_delta':
          // usage here is cumulative: the last one wins
          completionTokens = event.usage?.output_tokens ?? completionTokens;
          stopReason = event.delta?.stop_reason ?? stopReason;
          break;
        case 'error':
          // Anthropic reports mid-stream failures (e.g. overloaded) in-band
          throw new ProviderError(event.error?.message ?? 'The provider reported an error.', event.error?.type);
      }
    }
    const finishReason = finishReasonOf(stopReason);
    yield {
      type: 'finish',
      ...(finishReason !== undefined ? { finishReason } : {}),
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  },
});
