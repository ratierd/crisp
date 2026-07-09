import type { KeyedProvider } from './contracts';

/**
 * The port through which the registry learns what the server is configured
 * with — the only fact about the environment this slice needs. The server's
 * env loader satisfies it at the composition root.
 */
export interface KeyConfig {
  /** The demo Model is served (and therefore runnable) only when enabled. */
  demoEnabled: boolean;
  /** The server-held key for a provider, or null when none is configured. */
  serverKeyFor(provider: KeyedProvider): string | null;
}
