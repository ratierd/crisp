import { describe, expect, it } from 'vitest';
import type { Model } from '@crisp/models/contracts';
import { FakeModelGateway } from '@crisp/runs/testing';
import type { ConversationRenamer } from './ports';
import { TitleService, sanitizeGeneratedTitle } from './service';

const demoModel: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

class FakeRenamer implements ConversationRenamer {
  readonly renames: Array<{ conversationId: string; title: string }> = [];
  async rename(conversationId: string, title: string): Promise<void> {
    this.renames.push({ conversationId, title });
  }
}

const setup = (gateway: FakeModelGateway) => {
  const renamer = new FakeRenamer();
  // the runs slice's gateway fake satisfies TitleModel structurally —
  // exactly how the real adapter serves both slices
  return { renamer, service: new TitleService({ model: gateway, conversations: renamer }) };
};

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

describe('TitleService', () => {
  it('renames the conversation from streamed deltas', async () => {
    const gateway = new FakeModelGateway({
      events: [
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '"Serif ' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'legibility"' },
      ],
    });
    const { renamer, service } = setup(gateway);

    await service.generate('conv-1', demoModel, 'why serif?', 'Because…');
    expect(renamer.renames).toEqual([{ conversationId: 'conv-1', title: 'Serif legibility' }]);
  });

  it('forwards the BYOK key so the title run bills the same account', async () => {
    const gateway = new FakeModelGateway({
      events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'A title' }],
    });
    const { service } = setup(gateway);

    await service.generate('conv-1', demoModel, 'why serif?', 'Because…', 'sk-user');
    expect(gateway.calls[0]!.apiKey).toBe('sk-user');
  });

  it('keeps the fallback title when the title run errors', async () => {
    const gateway = new FakeModelGateway({
      events: [{ type: 'RUN_ERROR', code: 'provider_unavailable', message: 'down' }],
    });
    const { renamer, service } = setup(gateway);

    await service.generate('conv-1', demoModel, 'why serif?', 'Because…');
    expect(renamer.renames).toEqual([]);
  });

  it('keeps the fallback title when the model output is unusable', async () => {
    const gateway = new FakeModelGateway({
      events: [{ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '""' }],
    });
    const { renamer, service } = setup(gateway);

    await service.generate('conv-1', demoModel, 'why serif?', 'Because…');
    expect(renamer.renames).toEqual([]);
  });
});
