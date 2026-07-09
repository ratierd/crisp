export interface Env {
  port: number;
  dbPath: string;
  redisUrl: string;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  openrouterApiKey: string | null;
  langsmithApiKey: string | null;
  langsmithProject: string | null;
  staticDir: string | null;
  /** Per-IP rate limiting; CRISP_RATE_LIMIT=off disables it (e2e, local load tests). */
  rateLimitEnabled: boolean;
  /** The zero-key Demo model; CRISP_DEMO=off hides it (deployed instances). */
  demoEnabled: boolean;
}

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => ({
  port: Number(source.PORT ?? 3000),
  dbPath: source.DB_PATH ?? './data/crisp.sqlite',
  redisUrl: source.REDIS_URL ?? 'redis://localhost:6379',
  anthropicApiKey: source.ANTHROPIC_API_KEY || null,
  openaiApiKey: source.OPENAI_API_KEY || null,
  openrouterApiKey: source.OPENROUTER_API_KEY || null,
  langsmithApiKey: source.LANGSMITH_API_KEY || null,
  langsmithProject: source.LANGSMITH_PROJECT || null,
  staticDir: source.STATIC_DIR || null,
  rateLimitEnabled: source.CRISP_RATE_LIMIT !== 'off',
  demoEnabled: source.CRISP_DEMO !== 'off',
});
