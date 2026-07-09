import type { Hono } from 'hono';
import { feedbackRequestSchema } from '@crisp/feedback';
import type { FeedbackService } from '@crisp/feedback';
import type { AppEnv, Guard } from '../app';

export interface FeedbackRoutesDeps {
  guard: Guard;
  feedback: FeedbackService;
}

export const registerFeedbackRoutes = (app: Hono<AppEnv>, deps: FeedbackRoutesDeps) => {
  app.put('/api/runs/:runId/feedback', deps.guard('mutate'), async (c) => {
    const parsed = feedbackRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Malformed feedback request.' }, 400);
    const feedback = parsed.data.score
      ? {
          score: parsed.data.score,
          ...(parsed.data.comment ? { comment: parsed.data.comment } : {}),
        }
      : null;
    const found = await deps.feedback.set(c.req.param('runId'), feedback, c.get('owner'));
    if (!found) return c.json({ error: 'No message for that run.' }, 404);
    return c.json({ ok: true });
  });
};
