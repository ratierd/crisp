import { z } from 'zod';

/** The user's thumbs verdict on a Run, shown on the Message it produced. */
export const feedbackSchema = z.object({
  score: z.enum(['up', 'down']),
  comment: z.string().optional(),
});
export type Feedback = z.infer<typeof feedbackSchema>;

/** Body of PUT /api/runs/:runId/feedback. `score: null` retracts the vote. */
export const feedbackRequestSchema = z.object({
  score: z.enum(['up', 'down']).nullable(),
  comment: z.string().max(2000).optional(),
});
export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
