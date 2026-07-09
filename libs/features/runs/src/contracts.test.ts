import { describe, expect, it } from 'vitest';
import { chatRequestSchema, runErrorKindSchema } from './contracts';

describe('chatRequestSchema', () => {
  it('accepts the AG-UI RunAgentInput shape and keeps unknown fields', () => {
    const parsed = chatRequestSchema.parse({
      threadId: 'conv-1',
      runId: 'run-1',
      state: {},
      tools: [],
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', content: 'hi' }] }],
      forwardedProps: { modelId: 'demo/demo', extra: true },
    });
    expect(parsed.threadId).toBe('conv-1');
    expect(parsed.forwardedProps.modelId).toBe('demo/demo');
  });

  it('rejects requests without a model id', () => {
    const result = chatRequestSchema.safeParse({
      threadId: 'conv-1',
      messages: [{}],
      forwardedProps: {},
    });
    expect(result.success).toBe(false);
  });
});

describe('runErrorKindSchema', () => {
  it('covers the five-kind taxonomy', () => {
    expect(runErrorKindSchema.options).toEqual([
      'provider_unavailable',
      'auth_failed',
      'rate_limited',
      'aborted',
      'unknown',
    ]);
  });
});
