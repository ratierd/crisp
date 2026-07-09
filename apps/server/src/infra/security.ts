/**
 * Security & caching policy for the statically-served web app. Kept free of
 * Bun-only imports so tests can verify the policy under Node — bootstrap.ts
 * is the only consumer at runtime.
 */

/**
 * Hashes of the inline <script> blocks the web app's index.html is allowed
 * to run. Currently one: the pre-paint theme snippet (reads localStorage and
 * sets data-theme before first render, so dark mode never flashes).
 *
 * The contract with apps/web is locked by test/security.test.ts, which
 * re-hashes the actual index.html — change the snippet and that test tells
 * you the new hash to put here.
 */
export const CSP_INLINE_SCRIPT_HASHES = [
  'sha256-PXC2MziKWi6tIzlXvm7WxLQ/VDHKRDITJJPInAVnFS4=',
] as const;

/**
 * Enforced CSP for HTML documents (frontend's spec). Notable directives:
 * - script-src: only bundled modules, WASM (Shiki), and the hashed theme snippet.
 * - connect-src: same-origin APIs, the visitor's own Ollama daemon on
 *   localhost — BYO models are fetched by the *browser* (ADR-0004) — and
 *   openrouter.ai, where the browser exchanges the OAuth PKCE code for a
 *   user-scoped key (ADR-0006's one-click connect).
 * - style-src-attr 'unsafe-inline': Vue/Shiki inline style attributes.
 */
export const CSP_DIRECTIVES = {
  defaultSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    "'wasm-unsafe-eval'",
    ...CSP_INLINE_SCRIPT_HASHES.map((hash) => `'${hash}'`),
  ],
  styleSrc: ["'self'"],
  styleSrcAttr: ["'unsafe-inline'"],
  connectSrc: [
    "'self'",
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'https://openrouter.ai',
  ],
  imgSrc: ["'self'", 'data:'],
  // data:: Vite inlines font subsets under its asset-inline threshold as
  // data: URIs inside the CSS; data: fonts carry no exfiltration channel.
  fontSrc: ["'self'", 'data:'],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  objectSrc: ["'none'"],
};

/** Static-asset caching (frontend's spec). API responses are no-store in app.ts. */
export const cacheControlFor = (pathname: string): string => {
  // Vite emits content-hashed filenames under /assets — safe to cache forever.
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable';
  if (
    pathname === '/favicon.svg' ||
    pathname === '/byo-ollama.html' ||
    pathname === '/byo-ollama.css'
  ) {
    return 'public, max-age=3600';
  }
  // index.html and the SPA fallback: revalidate on every navigation.
  return 'no-cache';
};
