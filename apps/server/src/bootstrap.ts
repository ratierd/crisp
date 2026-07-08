import { serveStatic } from 'hono/bun';
import { createApp } from './app';
import { loadEnv } from './infra/env';
import { ModelRegistry } from './infra/model-registry';
import { RedisRunStreamStore } from './infra/redis-run-stream-store';
import { SqliteConversationRepository } from './infra/sqlite-conversation-repository';
import { AiModelGateway } from './infra/ai-gateway';

/**
 * Composition root for the real process. Bun-only imports (bun:sqlite,
 * hono/bun) live here so app.ts stays loadable under Node (vitest).
 */
export const createProductionApp = async () => {
  const env = loadEnv();
  const registry = new ModelRegistry(env);
  const gateway = new AiModelGateway(env);
  const conversations = new SqliteConversationRepository(env.dbPath);
  const runStreams = await RedisRunStreamStore.connect(env.redisUrl);
  const { app, runManager } = createApp({ env, registry, gateway, conversations, runStreams });

  if (env.staticDir) {
    app.use('*', serveStatic({ root: env.staticDir }));
    app.get('*', serveStatic({ path: `${env.staticDir}/index.html` }));
  }

  return { app, runManager };
};
