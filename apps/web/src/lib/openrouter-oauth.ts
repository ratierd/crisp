/**
 * One-click BYOK via OpenRouter's OAuth PKCE flow: we send the visitor to
 * openrouter.ai with a hashed one-time verifier, they approve, and the
 * redirect back carries a code we exchange for a brand-new user-scoped API
 * key. From there on that key is ordinary BYOK (ADR-0006): localStorage only,
 * rides each request, never stored server-side. PKCE needs no client secret,
 * so the whole flow lives in the browser.
 * Docs: https://openrouter.ai/docs/guides/overview/auth/oauth
 */

const VERIFIER_KEY = 'crisp:openrouter-verifier';
const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

const base64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

export const startOpenRouterConnect = async (
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<void> => {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  // sessionStorage: the verifier only needs to survive the redirect round-trip
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', `${window.location.origin}/`);
  url.searchParams.set('code_challenge', base64url(new Uint8Array(digest)));
  url.searchParams.set('code_challenge_method', 'S256');
  navigate(url.toString());
};

/**
 * Call once at boot. If the URL carries a ?code from a connect this browser
 * started, exchange it for the key and scrub the code from the address bar
 * first (it is single-use — it must not survive into history or a reload).
 * Returns the minted key, or null when there is nothing to complete or the
 * exchange failed (silent: the picker simply stays unconnected).
 */
export const completeOpenRouterConnect = async (): Promise<string | null> => {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !verifier) return null;
  sessionStorage.removeItem(VERIFIER_KEY);
  url.searchParams.delete('code');
  history.replaceState(null, '', url.toString());
  try {
    const response = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { key?: unknown };
    return typeof body.key === 'string' && body.key.length > 0 ? body.key : null;
  } catch {
    return null;
  }
};
