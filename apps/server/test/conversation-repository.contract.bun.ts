import { afterEach, describe, expect, it } from 'bun:test';
import type { Conversation, Message } from '@crisp/contracts';
import type { ConversationRepository } from '@crisp/domain';
import { FakeConversationRepository } from '@crisp/domain/testing';
import { SqliteConversationRepository } from '../src/infra/sqlite-conversation-repository';

/**
 * One contract, two implementations. Everything the routes and services may
 * rely on must hold identically for the in-memory fake (which the rest of
 * the test suite trusts) and the real SQLite repository — if these drift,
 * green unit tests stop meaning anything about production.
 */
const implementations = [
  {
    name: 'FakeConversationRepository',
    make: (): ConversationRepository & { close?: () => void } => new FakeConversationRepository(),
  },
  {
    name: 'SqliteConversationRepository(:memory:)',
    make: (): ConversationRepository & { close?: () => void } =>
      new SqliteConversationRepository(':memory:'),
  },
];

const conversation = (id: string, overrides: Partial<Conversation> = {}): Conversation => ({
  id,
  title: 'New conversation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const message = (id: string, overrides: Partial<Message> = {}): Message => ({
  id,
  role: 'user',
  parts: [{ type: 'text', content: `content of ${id}` }],
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

for (const { name, make } of implementations) {
  describe(`ConversationRepository contract: ${name}`, () => {
    let repo: ConversationRepository & { close?: () => void };

    const fresh = () => {
      repo = make();
      return repo;
    };

    afterEach(() => {
      repo?.close?.();
    });

    it('round-trips a created conversation for its owner, empty and with no live run', async () => {
      const repo = fresh();
      await repo.create(conversation('c1', { title: 'Hello' }), 'alice');
      const got = await repo.get('c1', 'alice');
      expect(got).toMatchObject({ id: 'c1', title: 'Hello', messages: [], activeRunId: null });
    });

    it('an id can be created once — a duplicate create throws, whoever asks (PK contract behind the 409)', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await expect(repo.create(conversation('c1'), 'alice')).rejects.toThrow();
      await expect(repo.create(conversation('c1'), 'mallory')).rejects.toThrow();
    });

    it('get is owner-scoped: a foreign owner sees null, not an error', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      expect(await repo.get('c1', 'mallory')).toBeNull();
      expect(await repo.get('missing', 'alice')).toBeNull();
    });

    it('list returns only the owner’s conversations, most recently updated first', async () => {
      const repo = fresh();
      await repo.create(conversation('old', { updatedAt: '2026-01-01T00:00:00.000Z' }), 'alice');
      await repo.create(conversation('new', { updatedAt: '2026-02-01T00:00:00.000Z' }), 'alice');
      await repo.create(conversation('other', { updatedAt: '2026-03-01T00:00:00.000Z' }), 'bob');

      expect((await repo.list('alice')).map((c) => c.id)).toEqual(['new', 'old']);
      expect((await repo.list('bob')).map((c) => c.id)).toEqual(['other']);
      expect(await repo.list('nobody')).toEqual([]);
    });

    it('appending a message bumps the conversation’s recency (sidebar ordering)', async () => {
      const repo = fresh();
      await repo.create(conversation('stale', { updatedAt: '2020-01-01T00:00:00.000Z' }), 'alice');
      await repo.create(conversation('recent', { updatedAt: '2025-01-01T00:00:00.000Z' }), 'alice');

      await repo.appendMessage('stale', message('m1'));
      expect((await repo.list('alice')).map((c) => c.id)).toEqual(['stale', 'recent']);
    });

    it('messages come back in append order, feedback/stats fields intact', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.appendMessage('c1', message('m1'));
      await repo.appendMessage(
        'c1',
        message('m2', {
          role: 'assistant',
          runId: 'run-a',
          modelId: 'demo/demo',
          stats: { ttftMs: 12, tokensPerSec: 34 },
          stoppedEarly: true,
        }),
      );
      await repo.appendMessage('c1', message('m3'));

      const got = await repo.get('c1', 'alice');
      expect(got!.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
      expect(got!.messages[1]).toMatchObject({
        runId: 'run-a',
        modelId: 'demo/demo',
        stats: { ttftMs: 12, tokensPerSec: 34 },
        stoppedEarly: true,
      });
    });

    it('rename is unscoped (server-internal, e.g. auto-titling) and ignores unknown ids', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.rename('c1', 'Titled by the model');
      expect((await repo.get('c1', 'alice'))!.title).toBe('Titled by the model');
      await expect(repo.rename('missing', 'whatever')).resolves.toBeUndefined();
    });

    it('delete is owner-scoped: a foreign delete is a no-op and the id stays taken', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.delete('c1', 'mallory');
      expect(await repo.get('c1', 'alice')).not.toBeNull();
      await expect(repo.create(conversation('c1'), 'mallory')).rejects.toThrow(); // still taken

      await repo.delete('c1', 'alice');
      expect(await repo.get('c1', 'alice')).toBeNull();
      await expect(repo.delete('c1', 'alice')).resolves.toBeUndefined(); // idempotent
    });

    it('deleting a conversation deletes its messages: re-creating the id starts empty', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.appendMessage('c1', message('m1'));
      await repo.delete('c1', 'alice');

      await repo.create(conversation('c1'), 'alice');
      expect((await repo.get('c1', 'alice'))!.messages).toEqual([]);
    });

    it('deleteMessagesAfter keeps the anchor, drops the rest (regenerate)', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      for (const id of ['m1', 'm2', 'm3', 'm4']) await repo.appendMessage('c1', message(id));

      await repo.deleteMessagesAfter('c1', 'm2');
      expect((await repo.get('c1', 'alice'))!.messages.map((m) => m.id)).toEqual(['m1', 'm2']);

      // a fresh append lands after the anchor, in order
      await repo.appendMessage('c1', message('m5'));
      expect((await repo.get('c1', 'alice'))!.messages.map((m) => m.id)).toEqual([
        'm1',
        'm2',
        'm5',
      ]);
    });

    it('deleteMessagesAfter with an unknown anchor is a no-op', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.appendMessage('c1', message('m1'));
      await repo.deleteMessagesAfter('c1', 'not-there');
      expect((await repo.get('c1', 'alice'))!.messages.map((m) => m.id)).toEqual(['m1']);
    });

    it('setFeedback finds the message by runId within the owner’s conversations', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.appendMessage('c1', message('m1', { role: 'assistant', runId: 'run-a' }));

      expect(await repo.setFeedback('run-a', { score: 'up' }, 'alice')).toBe(true);
      expect((await repo.get('c1', 'alice'))!.messages[0]!.feedback).toEqual({ score: 'up' });

      // change the vote, with a comment
      expect(await repo.setFeedback('run-a', { score: 'down', comment: 'meh' }, 'alice')).toBe(
        true,
      );
      expect((await repo.get('c1', 'alice'))!.messages[0]!.feedback).toEqual({
        score: 'down',
        comment: 'meh',
      });

      // retract
      expect(await repo.setFeedback('run-a', null, 'alice')).toBe(true);
      expect((await repo.get('c1', 'alice'))!.messages[0]!.feedback).toBeUndefined();
    });

    it('setFeedback refuses unknown runs and foreign owners with false, leaving votes intact', async () => {
      const repo = fresh();
      await repo.create(conversation('c1'), 'alice');
      await repo.appendMessage(
        'c1',
        message('m1', { role: 'assistant', runId: 'run-a', feedback: { score: 'up' } }),
      );

      expect(await repo.setFeedback('missing-run', { score: 'up' }, 'alice')).toBe(false);
      expect(await repo.setFeedback('run-a', { score: 'down' }, 'mallory')).toBe(false);
      expect((await repo.get('c1', 'alice'))!.messages[0]!.feedback).toEqual({ score: 'up' });
    });
  });
}
