import { describe, expect, it } from 'vitest';
import { demoRun } from '../src/infra/demo-provider';
import { pickTourEntry } from '../src/infra/tour-script';

describe('pickTourEntry', () => {
  it('maps each Tour Question to its entry', () => {
    expect(pickTourEntry('What can Crisp do? Show me around.').title).toBe('Crisp feature tour');
    expect(pickTourEntry('How is Crisp architected?').title).toBe('How Crisp is built');
    expect(pickTourEntry('What monitoring and observability is in place?').title).toBe(
      'Monitoring & observability',
    );
    expect(
      pickTourEntry('How does streaming work — what happens if I refresh mid-answer?').title,
    ).toBe('Streaming and resume');
    expect(pickTourEntry('what is oklch?').title).toBe('OKLCH for designers');
  });

  it('falls back to the feature tour for anything else', () => {
    expect(pickTourEntry('hello there').title).toBe('Crisp feature tour');
  });
});

describe('demoRun and the tour', () => {
  const run = async (messages: Array<{ role: 'user' | 'system'; content: string }>) => {
    let text = '';
    const events = demoRun(
      {
        model: {
          id: 'demo/demo',
          displayName: 'Demo',
          provider: 'Crisp',
          provenance: 'local',
          available: true,
        },
        messages,
        runId: 'r1',
        threadId: 't1',
      },
      { delayMs: 0 },
    );
    for await (const event of events) {
      if (event.type === 'TEXT_MESSAGE_CONTENT' && typeof event.delta === 'string')
        text += event.delta;
    }
    return text;
  };

  it('streams the matched canned answer for a chat run', async () => {
    const text = await run([{ role: 'user', content: 'How is Crisp architected?' }]);
    expect(text).toContain('feature slices');
  });

  it('answers a titling run with the matched canned title', async () => {
    const text = await run([
      { role: 'system', content: 'Reply with a short title (max six words)…' },
      { role: 'user', content: 'User: How is Crisp architected?\n\nAssistant: Crisp is a…' },
    ]);
    expect(text).toBe('How Crisp is built');
  });
});
