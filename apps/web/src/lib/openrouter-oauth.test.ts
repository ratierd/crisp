// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://crisp.example.dev/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completeOpenRouterConnect, startOpenRouterConnect } from './openrouter-oauth';

const VERIFIER_KEY = 'crisp:openrouter-verifier';

const sha256base64url = async (input: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

beforeEach(() => {
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('startOpenRouterConnect', () => {
  it('stores a verifier and redirects to OpenRouter with its S256 challenge', async () => {
    const navigate = vi.fn();
    await startOpenRouterConnect(navigate);

    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    expect(verifier).toBeTruthy();

    const url = new URL(navigate.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(url.searchParams.get('callback_url')).toBe('https://crisp.example.dev/');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(await sha256base64url(verifier!));
  });

  it('mints a fresh verifier per attempt', async () => {
    const navigate = vi.fn();
    await startOpenRouterConnect(navigate);
    const first = sessionStorage.getItem(VERIFIER_KEY);
    await startOpenRouterConnect(navigate);
    expect(sessionStorage.getItem(VERIFIER_KEY)).not.toBe(first);
  });
});

describe('completeOpenRouterConnect', () => {
  it('is a no-op without a pending code', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await completeOpenRouterConnect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores a ?code this browser never initiated', async () => {
    history.replaceState(null, '', '/?code=stray');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await completeOpenRouterConnect()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the code for a key and scrubs the URL', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'verif-1');
    history.replaceState(null, '', '/?code=auth-1');
    const fetchMock = vi.fn(async () => Response.json({ key: 'sk-or-v1-minted' }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await completeOpenRouterConnect()).toBe('sk-or-v1-minted');

    const [target, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(target).toBe('https://openrouter.ai/api/v1/auth/keys');
    expect(JSON.parse(init.body as string)).toEqual({
      code: 'auth-1',
      code_verifier: 'verif-1',
      code_challenge_method: 'S256',
    });
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
  });

  it('returns null on a failed exchange but still consumes the attempt', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'verif-1');
    history.replaceState(null, '', '/?code=auth-1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 403 })));

    expect(await completeOpenRouterConnect()).toBeNull();
    expect(window.location.search).toBe('');
    expect(sessionStorage.getItem(VERIFIER_KEY)).toBeNull();
  });

  it('treats a network error as a silent failure', async () => {
    sessionStorage.setItem(VERIFIER_KEY, 'verif-1');
    history.replaceState(null, '', '/?code=auth-1');
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    expect(await completeOpenRouterConnect()).toBeNull();
  });
});
