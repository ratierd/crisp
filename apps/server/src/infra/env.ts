export interface Env {
  port: number;
  dbPath: string;
  redisUrl: string;
  ollamaBaseUrl: string;
  anthropicApiKey: string | null;
  openaiApiKey: string | null;
  langsmithApiKey: string | null;
  langsmithProject: string | null;
  staticDir: string | null;
}

export const loadEnv = (source: Record<string, string | undefined> = process.env): Env => ({
  port: Number(source.PORT ?? 3000),
  dbPath: source.DB_PATH ?? './data/crisp.sqlite',
  redisUrl: source.REDIS_URL ?? 'redis://localhost:6379',
  ollamaBaseUrl: source.OLLAMA_BASE_URL ?? 'http://localhost:11434',
  anthropicApiKey: source.ANTHROPIC_API_KEY || null,
  openaiApiKey: source.OPENAI_API_KEY || null,
  langsmithApiKey: source.LANGSMITH_API_KEY || null,
  langsmithProject: source.LANGSMITH_PROJECT || null,
  staticDir: source.STATIC_DIR || null,
});
