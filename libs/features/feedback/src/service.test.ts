import { describe, expect, it } from 'vitest';
import type { Feedback } from './contracts';
import { FeedbackService } from './service';

const setup = (found: boolean) => {
  const stored: Array<Feedback | null> = [];
  const mirrored: Array<Feedback | null> = [];
  const service = new FeedbackService({
    store: {
      setFeedback: async (_runId, feedback) => {
        if (found) stored.push(feedback);
        return found;
      },
    },
    sink: { record: async (_runId, feedback) => void mirrored.push(feedback) },
  });
  return { service, stored, mirrored };
};

describe('FeedbackService', () => {
  it('stores the verdict and mirrors it', async () => {
    const { service, stored, mirrored } = setup(true);
    expect(await service.set('run-1', { score: 'up' }, 'visitor-1')).toBe(true);
    expect(stored).toEqual([{ score: 'up' }]);
    expect(mirrored).toEqual([{ score: 'up' }]);
  });

  it('a retraction (null) flows to both store and mirror', async () => {
    const { service, stored, mirrored } = setup(true);
    await service.set('run-1', null, 'visitor-1');
    expect(stored).toEqual([null]);
    expect(mirrored).toEqual([null]);
  });

  it('mirrors nothing when the Run is not visible to the owner', async () => {
    const { service, mirrored } = setup(false);
    expect(await service.set('run-1', { score: 'down' }, 'visitor-2')).toBe(false);
    expect(mirrored).toEqual([]);
  });
});
