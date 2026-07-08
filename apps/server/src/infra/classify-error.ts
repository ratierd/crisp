import type { RunErrorKind } from '@crisp/contracts';

/**
 * Maps a raw provider error onto the Crisp taxonomy. Providers surface
 * failures as free-form messages and occasional codes, so this is
 * necessarily pattern-based; anything unrecognized stays `unknown`.
 */
export const classifyProviderError = (message: string, code?: string): RunErrorKind => {
  const haystack = `${code ?? ''} ${message}`.toLowerCase();
  if (/\babort/.test(haystack)) return 'aborted';
  if (/(\b401\b|\b403\b|unauthorized|forbidden|authentication|invalid.{0,10}(api.)?key|api key)/.test(haystack)) {
    return 'auth_failed';
  }
  if (/(\b429\b|rate.?limit|too many requests|quota|overloaded)/.test(haystack)) {
    return 'rate_limited';
  }
  if (
    /(econnrefused|enotfound|econnreset|fetch failed|network|unreachable|not running|timed?.?out|\b50[0-4]\b|connection (error|refused|closed)|service unavailable)/.test(
      haystack,
    )
  ) {
    return 'provider_unavailable';
  }
  return 'unknown';
};
