/**
 * Provider failures surface as thrown Errors whose message keeps the raw
 * provider text (plus the HTTP status when there is one). The app's error
 * classifier is pattern-based over exactly that raw text, so nothing here
 * may translate or prettify — only pass through.
 */
export class ProviderError extends Error {
  /** Provider-reported machine code (e.g. `invalid_api_key`), when present. */
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ProviderError';
    if (code !== undefined) this.code = code;
  }
}

/** Digs the human message out of the JSON error bodies providers return. */
const errorText = (body: unknown): { message?: string; code?: string } => {
  if (typeof body !== 'object' || body === null) return {};
  const error = (body as { error?: unknown }).error;
  if (typeof error === 'string') return { message: error };
  if (typeof error !== 'object' || error === null) return {};
  const { message, type, code } = error as { message?: unknown; type?: unknown; code?: unknown };
  return {
    ...(typeof message === 'string' ? { message } : {}),
    ...(typeof code === 'string' ? { code: code } : typeof type === 'string' ? { code: type } : {}),
  };
};

/** Throws a ProviderError for a non-2xx response, embedding the status. */
export const throwOnHttpError = async (response: Response, provider: string): Promise<void> => {
  if (response.ok) return;
  let detail: { message?: string; code?: string } = {};
  try {
    const text = await response.text();
    try {
      detail = errorText(JSON.parse(text));
    } catch {
      if (text.length > 0) detail = { message: text.slice(0, 500) };
    }
  } catch {
    // unreadable body — the status line will have to do
  }
  const suffix = detail.message ? `: ${detail.message}` : '';
  throw new ProviderError(
    `${provider} request failed with status ${response.status} ${response.statusText}${suffix}`,
    detail.code,
  );
};
