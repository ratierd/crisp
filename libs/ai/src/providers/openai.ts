import { openaiCompatibleText } from './openai-compatible';
import type { TextAdapter } from '../core/types';

/**
 * OpenAI text adapter — the canonical chat-completions endpoint, so it is the
 * compatible adapter pointed at api.openai.com. The model name is a plain
 * string on purpose: model catalogs churn faster than any literal union, and
 * the server's ModelRegistry is the actual gatekeeper.
 */
export const createOpenaiChat = (model: string, apiKey: string): TextAdapter =>
  openaiCompatibleText(model, {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey,
  });
