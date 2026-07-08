import { serveStatic } from 'hono/bun';
import { Client } from 'langsmith';
import type { FeedbackSink, ModelGateway, RunMirror } from '@crisp/domain';
import { createApp } from './app';
import { loadEnv } from './infra/env';
import { LangsmithFeedbackSink } from './infra/langsmith-feedback-sink';
import { LangsmithRunMirror } from './infra/langsmith-run-mirror';
import { LangsmithTracingGateway } from './infra/langsmith-tracing-gateway';
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
  let gateway: ModelGateway = new AiModelGateway(env);
  let feedback: FeedbackSink | undefined;
  let runMirror: RunMirror | undefined;
  if (env.langsmithApiKey) {
    // Observability is a decorator on the gateway port (ADR-0005): without
    // the key the app composes exactly as before.
    const client = new Client({ apiKey: env.langsmithApiKey });
    const project = env.langsmithProject ?? undefined;
    gateway = new LangsmithTracingGateway(gateway, client, project);
    feedback = new LangsmithFeedbackSink(client);
    runMirror = new LangsmithRunMirror(client, project);
  }
  const conversations = new SqliteConversationRepository(env.dbPath);
  const runStreams = await RedisRunStreamStore.connect(env.redisUrl);
  const { app, runManager } = createApp({ env, registry, gateway, conversations, runStreams, feedback, runMirror });

  if (env.staticDir) {
    app.use('*', serveStatic({ root: env.staticDir }));
    app.get('*', serveStatic({ path: `${env.staticDir}/index.html` }));
  }

  return { app, runManager };
};
