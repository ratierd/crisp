import type { Model } from '@crisp/contracts';
import { describe, expect, it } from 'vitest';
import { FakeConversationRepository, FakeModelGateway } from '../testing/fakes';
import { ConversationService } from './conversation-service';
import { TitleService } from './title-service';

const demoModel: Model = {
  id: 'demo/demo',
  displayName: 'Demo',
  provider: 'the demo provider',
  provenance: 'local',
  available: true,
};

const setup = (gateway: FakeModelGateway) => {
  const repo = new FakeConversationRepository();
  const conversations = new ConversationService({ conversations: repo });
  return { conversations, service: new TitleService({ gateway, conversations }) };
};

describe('TitleService', () => {
  it('renames the conversation from streamed deltas', async () => {
    const gateway = new FakeModelGateway({
      events: [
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: '"Serif ' },
        { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm', delta: 'legibility"' },
      ],
    });
    const { conversations, service } = setup(gateway);
    const conversation = await conversations.create('why serif?');

    await service.generate(conversation.id, demoModel, 'why serif?', 'Because…');
    expect((await conversations.get(conversation.id))!.title).toBe('Serif legibility');
  });

  it('keeps the fallback title when the title run errors', async () => {
    const gateway = new FakeModelGateway({
      events: [{ type: 'RUN_ERROR', code: 'provider_unavailable', message: 'down' }],
    });
    const { conversations, service } = setup(gateway);
    const conversation = await conversations.create('why serif?');

    await service.generate(conversation.id, demoModel, 'why serif?', 'Because…');
    expect((await conversations.get(conversation.id))!.title).toBe('why serif?');
  });
});
