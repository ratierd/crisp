import type { Hono } from 'hono';
import type { ConversationService } from '@crisp/conversations';
import type { RunStreamStore } from '@crisp/runs';
import type { AppEnv, Guard } from '../app';

export interface ConversationRoutesDeps {
  guard: Guard;
  conversations: ConversationService;
  /** Only for activeRun(): a reloading client needs the live Run id to reattach. */
  runStreams: RunStreamStore;
}

export const registerConversationRoutes = (app: Hono<AppEnv>, deps: ConversationRoutesDeps) => {
  app.get('/api/conversations', deps.guard('read'), async (c) =>
    c.json({ conversations: await deps.conversations.list(c.get('owner')) }),
  );

  app.get('/api/conversations/:id', deps.guard('read'), async (c) => {
    const conversation = await deps.conversations.get(c.req.param('id'), c.get('owner'));
    if (!conversation) return c.json({ error: 'Conversation not found.' }, 404);
    const activeRunId = await deps.runStreams.activeRun(conversation.id);
    return c.json({ ...conversation, activeRunId });
  });

  app.delete('/api/conversations/:id', deps.guard('mutate'), async (c) => {
    await deps.conversations.delete(c.req.param('id'), c.get('owner'));
    return c.body(null, 204);
  });
};
