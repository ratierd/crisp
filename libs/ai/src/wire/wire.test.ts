import { describe, expect, it } from 'vitest';
import { readWireMessages, uiMessagesToWire } from './index';
import type { UIMessage } from '../client';

const user = (content: string, id = 'u1') => ({ id, role: 'user', content });

describe('readWireMessages — text extraction precedence', () => {
  it('a content string mirror wins over parts', () => {
    const { history } = readWireMessages([
      { role: 'user', content: 'mirror', parts: [{ type: 'text', content: 'parts' }] },
    ]);
    expect(history).toEqual([{ role: 'user', content: 'mirror' }]);
  });

  it('joins text parts when there is no content string (raw UIMessage, the BYO path)', () => {
    const { history } = readWireMessages([
      {
        id: 'u1',
        role: 'user',
        parts: [
          { type: 'text', content: 'hello ' },
          { type: 'thinking', content: 'IGNORED' },
          { type: 'text', content: 'world' },
        ],
        createdAt: new Date(),
      },
    ]);
    expect(history).toEqual([{ role: 'user', content: 'hello world' }]);
  });

  it('falls back to content blocks when parts yield no text', () => {
    const { history } = readWireMessages([
      {
        role: 'user',
        parts: [{ type: 'thinking', content: 'IGNORED' }],
        content: [
          { type: 'text', text: 'from ' },
          { type: 'image', text: 'IGNORED-WRONG-TYPE' },
          { type: 'text', text: 'blocks' },
        ],
      },
    ]);
    expect(history).toEqual([{ role: 'user', content: 'from blocks' }]);
  });
});

describe('readWireMessages — history', () => {
  it('keeps user, assistant and system entries in order', () => {
    const { history } = readWireMessages([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant']);
  });

  it('drops non-anchor roles and entries with no text', () => {
    const { history } = readWireMessages([
      { role: 'tool', content: 'IGNORED' },
      { role: 'user', content: '' },
      { content: 'no role at all' },
      { role: 'user', content: 'kept' },
    ]);
    expect(history).toEqual([{ role: 'user', content: 'kept' }]);
  });

  it('reads an empty request as an empty history, not an error', () => {
    expect(readWireMessages([])).toEqual({
      history: [],
      trailingUserMessage: null,
      leadingSystemMessage: null,
    });
  });
});

describe('readWireMessages — leading system Message (the Tour Context)', () => {
  it('returns the first message as a persistable Message when it is a system turn', () => {
    const { leadingSystemMessage } = readWireMessages([
      { id: 's1', role: 'system', content: 'You are inside Crisp.' },
      user('question'),
    ]);
    expect(leadingSystemMessage).toMatchObject({
      id: 's1',
      role: 'system',
      parts: [{ type: 'text', content: 'You are inside Crisp.' }],
    });
    expect(typeof leadingSystemMessage?.createdAt).toBe('string');
  });

  it('is null when the conversation does not open with a system turn', () => {
    const { leadingSystemMessage } = readWireMessages([
      user('question'),
      { role: 'system', content: 'not leading' },
    ]);
    expect(leadingSystemMessage).toBeNull();
  });

  it('is null when the leading system message has no text', () => {
    const { leadingSystemMessage } = readWireMessages([{ role: 'system', content: '' }]);
    expect(leadingSystemMessage).toBeNull();
  });
});

describe('readWireMessages — trailing user Message', () => {
  it('returns the last message as a persistable Message when it is a user turn', () => {
    const { trailingUserMessage } = readWireMessages([
      { role: 'assistant', content: 'earlier answer' },
      user('latest question'),
    ]);
    expect(trailingUserMessage).toMatchObject({
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', content: 'latest question' }],
    });
    expect(typeof trailingUserMessage?.createdAt).toBe('string');
  });

  it('mints an id when the wire message has none', () => {
    const { trailingUserMessage } = readWireMessages([{ role: 'user', content: 'no id' }]);
    expect(trailingUserMessage?.id).toBeTruthy();
  });

  it('is null when the last message is not a user turn', () => {
    const { trailingUserMessage } = readWireMessages([
      user('question'),
      { role: 'assistant', content: 'answer' },
    ]);
    expect(trailingUserMessage).toBeNull();
  });

  it('is null when the trailing user message has no text', () => {
    const { trailingUserMessage } = readWireMessages([user('')]);
    expect(trailingUserMessage).toBeNull();
  });
});

describe('the codec round-trips', () => {
  it('readWireMessages reads back what uiMessagesToWire wrote', () => {
    const ui: UIMessage[] = [
      { id: 'a', role: 'system', parts: [{ type: 'text', content: 'be terse' }] },
      { id: 'b', role: 'assistant', parts: [{ type: 'text', content: 'hello' }] },
      { id: 'c', role: 'user', parts: [{ type: 'text', content: 'question' }] },
    ];
    const { history, trailingUserMessage } = readWireMessages(uiMessagesToWire(ui));
    expect(history).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'question' },
    ]);
    expect(trailingUserMessage?.id).toBe('c');
  });

  it('uiMessagesToWire mirrors only text parts into content', () => {
    const wire = uiMessagesToWire([
      {
        id: 'a',
        role: 'assistant',
        parts: [
          { type: 'thinking', content: 'IGNORED' },
          { type: 'text', content: 'visible' },
        ],
      },
    ]);
    expect(wire[0]?.content).toBe('visible');
    expect(wire[0]?.parts).toHaveLength(2);
  });
});
