import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CSP_DIRECTIVES, CSP_INLINE_SCRIPT_HASHES, cacheControlFor } from '../src/infra/security';

/**
 * Locks the CSP contract across packages: every inline <script> the web
 * app's index.html actually ships must be hash-allowed by the server's CSP.
 * When the snippet changes, this test prints the hash to update in
 * src/infra/security.ts.
 */

const INDEX_HTML = join(__dirname, '..', '..', 'web', 'index.html');

const inlineScripts = (html: string): string[] =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1] ?? '')
    .filter((body) => body.trim().length > 0);

const cspHash = (script: string): string =>
  `sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}`;

describe('CSP contract with apps/web', () => {
  it('hash-allows every inline script index.html ships', () => {
    const html = readFileSync(INDEX_HTML, 'utf8');
    for (const script of inlineScripts(html)) {
      const hash = cspHash(script);
      expect(
        (CSP_INLINE_SCRIPT_HASHES as readonly string[]).includes(hash),
        `inline script not allowed by CSP — add "${hash}" to CSP_INLINE_SCRIPT_HASHES ` +
          `(script starts: ${JSON.stringify(script.slice(0, 60))})`,
      ).toBe(true);
    }
  });

  it('pins the agreed theme-snippet hash and carries it in script-src', () => {
    // The exact bytes frontend committed to (lead's spec) — if the snippet
    // drifts, the test above fails with the replacement hash.
    const agreed =
      'var t=localStorage.getItem("crisp:theme");if(t)document.documentElement.dataset.theme=t';
    expect(cspHash(agreed)).toBe('sha256-vpGoRp2/fnDvwWqtFe9uDTb4XX3av23ijVVdRJ7CCNs=');
    for (const hash of CSP_INLINE_SCRIPT_HASHES) {
      expect(CSP_DIRECTIVES.scriptSrc).toContain(`'${hash}'`);
    }
  });

  it('keeps CSP pinned to the reviewed policy', () => {
    expect(CSP_DIRECTIVES.defaultSrc).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES.connectSrc).toEqual([
      "'self'",
      'http://localhost:11434',
      'http://127.0.0.1:11434',
      // OpenRouter OAuth PKCE — the browser exchanges the ?code for a key.
      'https://openrouter.ai',
    ]);
    // data: fonts — Vite inlines small font subsets into the CSS as data: URIs.
    expect(CSP_DIRECTIVES.fontSrc).toEqual(["'self'", 'data:']);
    expect(CSP_DIRECTIVES.frameAncestors).toEqual(["'none'"]);
    expect(CSP_DIRECTIVES.objectSrc).toEqual(["'none'"]);
  });
});

describe('cacheControlFor', () => {
  it('caches hashed assets forever, documents never, satellites briefly', () => {
    expect(cacheControlFor('/assets/index-BQx1Zx.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('/')).toBe('no-cache');
    expect(cacheControlFor('/index.html')).toBe('no-cache');
    expect(cacheControlFor('/conversations/abc')).toBe('no-cache'); // SPA fallback
    expect(cacheControlFor('/favicon.svg')).toBe('public, max-age=3600');
    expect(cacheControlFor('/byo-ollama.html')).toBe('public, max-age=3600');
    expect(cacheControlFor('/byo-ollama.css')).toBe('public, max-age=3600');
  });
});
