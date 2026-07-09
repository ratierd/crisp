import { describe, expect, it } from 'vitest';
import { formatDuration, relativeTime } from './relative-time';

describe('formatDuration', () => {
  it('keeps a decimal under ten seconds', () => {
    expect(formatDuration(840)).toBe('0.8s');
    expect(formatDuration(3400)).toBe('3.4s');
  });

  it('rounds to whole seconds under a minute', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(59_400)).toBe('59s');
  });

  it('switches to minutes and seconds past a minute', () => {
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(120_000)).toBe('2m 0s');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-07-09T12:00:00Z');

  it('covers the ladder from just now to days', () => {
    expect(relativeTime('2026-07-09T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-07-09T11:52:00Z', now)).toBe('8m ago');
    expect(relativeTime('2026-07-09T09:00:00Z', now)).toBe('3h ago');
    expect(relativeTime('2026-07-07T09:00:00Z', now)).toBe('2d ago');
  });
});
