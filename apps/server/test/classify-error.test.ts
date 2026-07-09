import { describe, expect, it } from 'vitest';
import type { RunErrorKind } from '@crisp/contracts';
import { classifyProviderError } from '../src/infra/classify-error';

/**
 * The taxonomy mapping is pattern-based over free-form provider messages
 * (see classify-error.ts), so this table doubles as a corpus of the real
 * strings each provider emits. When a new provider string misclassifies in
 * the wild, add it here first.
 */
describe('classifyProviderError', () => {
  const cases: Array<{ message: string; code?: string; expected: RunErrorKind }> = [
    // aborted — user-initiated stops, checked first
    { message: 'The user aborted a request.', expected: 'aborted' },
    { message: 'The operation was aborted', expected: 'aborted' },
    { message: 'signal is aborted without reason', expected: 'aborted' },

    // auth_failed — bad/missing credentials
    { message: '401 Unauthorized', expected: 'auth_failed' },
    { message: '403 Forbidden', expected: 'auth_failed' },
    { message: 'Incorrect API key provided: sk-abc***', expected: 'auth_failed' },
    { message: 'invalid x-api-key', expected: 'auth_failed' },
    // OpenAI puts the signal in the code, not the message
    { message: 'Request failed', code: 'invalid_api_key', expected: 'auth_failed' },
    { message: 'missing bearer or basic authentication in header', expected: 'auth_failed' },

    // rate_limited — throttling and quota exhaustion
    { message: '429 Too Many Requests', expected: 'rate_limited' },
    { message: 'Rate limit reached for gpt-4o in organization org-x', expected: 'rate_limited' },
    { message: 'You exceeded your current quota, please check your plan and billing details.', code: 'insufficient_quota', expected: 'rate_limited' },
    // Anthropic 529
    { message: 'Overloaded', code: 'overloaded_error', expected: 'rate_limited' },
    { message: 'RATE LIMIT EXCEEDED', expected: 'rate_limited' }, // case-folded

    // provider_unavailable — network/infra failures
    { message: 'fetch failed', expected: 'provider_unavailable' },
    { message: 'connect ECONNREFUSED 127.0.0.1:11434', expected: 'provider_unavailable' },
    { message: 'getaddrinfo ENOTFOUND api.openai.com', expected: 'provider_unavailable' },
    { message: 'read ECONNRESET', expected: 'provider_unavailable' },
    { message: 'Request timed out.', expected: 'provider_unavailable' },
    { message: 'timeout of 30000ms exceeded', expected: 'provider_unavailable' },
    { message: '500 Internal Server Error', expected: 'provider_unavailable' },
    { message: '503 Service Unavailable', expected: 'provider_unavailable' },
    { message: '504 Gateway Timeout', expected: 'provider_unavailable' },
    { message: 'Client network socket disconnected before secure TLS connection was established', expected: 'provider_unavailable' },
    { message: 'the daemon is not running', expected: 'provider_unavailable' },

    // unknown — anything unrecognized falls through, never throws
    { message: 'BOOM', expected: 'unknown' },
    { message: '', expected: 'unknown' },
    { message: 'Your credit balance is too low to access the API.', expected: 'unknown' },
  ];

  it.each(cases)('"$message" (code=$code) → $expected', ({ message, code, expected }) => {
    expect(classifyProviderError(message, code)).toBe(expected);
  });

  it('checks aborted before the other kinds (a stopped run is never blamed on the provider)', () => {
    expect(classifyProviderError('Request aborted: rate limit exceeded')).toBe('aborted');
    expect(classifyProviderError('aborted: fetch failed')).toBe('aborted');
  });

  it('folds the raw code into the haystack alongside the message', () => {
    expect(classifyProviderError('nope', '401')).toBe('auth_failed');
    expect(classifyProviderError('nope', 'rate_limit_error')).toBe('rate_limited');
    expect(classifyProviderError('nope', undefined)).toBe('unknown');
  });
});
