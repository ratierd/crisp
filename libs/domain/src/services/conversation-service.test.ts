import { describe, expect, it } from 'vitest';
import { FakeConversationRepository } from '../testing/fakes';
import { ConversationService, deriveFallbackTitle, sanitizeGeneratedTitle } from './conversation-service';

describe('deriveFallbackTitle', () => {
  it('keeps short messages as-is', () => {
    expect(deriveFallbackTitle('Explain OKLCH')).toBe('Explain OKLCH');
  });

  it('collapses whitespace', () => {
    expect(deriveFallbackTitle('  hello\n\nworld  ')).toBe('hello world');
  });

  it('truncates at 44 chars with an ellipsis', () => {
    const long = 'a'.repeat(80);
    const title = deriveFallbackTitle(long);
    expect(title.length).toBeLessThanOrEqual(44);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back for empty input', () => {
    expect(deriveFallbackTitle('   ')).toBe('New conversation');
  });
});

describe('sanitizeGeneratedTitle', () => {
  it('strips wrapping quotes and trailing punctuation', () => {
    expect(sanitizeGeneratedTitle('"Modern CSS theming."')).toBe('Modern CSS theming');
  });

  it('rejects unusable output', () => {
    expect(sanitizeGeneratedTitle('  " ')).toBeNull();
  });

  it('caps length at 60', () => {
    expect(sanitizeGeneratedTitle('x'.repeat(100))!.length).toBeLessThanOrEqual(60);
  });
});

describe('ConversationService', () => {
  it('creates a conversation titled from the first message', async () => {
    const repo = new FakeConversationRepository();
    const service = new ConversationService({ conversations: repo });
    const conversation = await service.create('Why does serif type read better in long form?');
    expect(conversation.title).toBe('Why does serif type read better in long for…');
    expect(await service.get(conversation.id)).not.toBeNull();
  });

  it('applies a generated title only when usable', async () => {
    const repo = new FakeConversationRepository();
    const service = new ConversationService({ conversations: repo });
    const conversation = await service.create('hello');
    await service.applyGeneratedTitle(conversation.id, '"Serif legibility"');
    expect((await service.get(conversation.id))!.title).toBe('Serif legibility');
    await service.applyGeneratedTitle(conversation.id, '""');
    expect((await service.get(conversation.id))!.title).toBe('Serif legibility');
  });
});
