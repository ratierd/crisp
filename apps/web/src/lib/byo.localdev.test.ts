// @vitest-environment jsdom
// jsdom's default URL is http://localhost:3000 — the local-dev half of the
// shouldAutoDiscover gate lives here; the deployed half is in byo.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { byoConnectCommand, shouldAutoDiscover } from './byo';

beforeEach(() => {
  localStorage.clear();
});

describe('shouldAutoDiscover in local dev', () => {
  it('always probes on localhost, even before any successful discovery', () => {
    expect(window.location.hostname).toBe('localhost');
    expect(shouldAutoDiscover()).toBe(true);
  });

  it('the connect command reflects the dev origin (though defaults already allow it)', () => {
    expect(byoConnectCommand()).toBe(`OLLAMA_ORIGINS=${window.location.origin} ollama serve`);
  });
});
