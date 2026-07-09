import { describe, expect, it } from 'vitest';
import { messageSchema } from './contracts';

describe('messageSchema', () => {
  it('round-trips a persisted assistant message', () => {
    const message = {
      id: 'm1',
      role: 'assistant' as const,
      parts: [{ type: 'text' as const, content: 'hello' }],
      createdAt: new Date().toISOString(),
      modelId: 'demo/demo',
      stats: { ttftMs: 120, tokensPerSec: 42, durationMs: 1300 },
      stoppedEarly: true,
    };
    expect(messageSchema.parse(message)).toEqual(message);
  });

  it('accepts a system message (the Tour Context, ADR-0009)', () => {
    const message = {
      id: 's1',
      role: 'system' as const,
      parts: [{ type: 'text' as const, content: 'You are inside Crisp.' }],
      createdAt: new Date().toISOString(),
    };
    expect(messageSchema.parse(message)).toEqual(message);
  });

  it('still rejects unknown roles', () => {
    expect(
      messageSchema.safeParse({ id: 'x', role: 'tool', parts: [], createdAt: '' }).success,
    ).toBe(false);
  });
});
