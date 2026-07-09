import { describe, expect, it } from 'vitest';
import { ConversationService, deriveFallbackTitle } from './service';
import { FakeConversationRepository } from './testing';

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

describe('ConversationService', () => {
  it('creates a conversation titled from the first message', async () => {
    const repo = new FakeConversationRepository();
    const service = new ConversationService({ conversations: repo });
    const conversation = await service.create(
      'Why does serif type read better in long form?',
      'visitor-1',
    );
    expect(conversation.title).toBe('Why does serif type read better in long for…');
    expect(await service.get(conversation.id, 'visitor-1')).not.toBeNull();
  });

  it('scopes reads and deletes to the owner', async () => {
    const repo = new FakeConversationRepository();
    const service = new ConversationService({ conversations: repo });
    const conversation = await service.create('mine', 'visitor-1');

    expect(await service.get(conversation.id, 'visitor-2')).toBeNull();
    expect(await service.list('visitor-2')).toEqual([]);
    expect((await service.list('visitor-1')).map((c) => c.id)).toEqual([conversation.id]);

    // a foreign delete is a no-op, not an error
    await service.delete(conversation.id, 'visitor-2');
    expect(await service.get(conversation.id, 'visitor-1')).not.toBeNull();
    await service.delete(conversation.id, 'visitor-1');
    expect(await service.get(conversation.id, 'visitor-1')).toBeNull();
  });
});
