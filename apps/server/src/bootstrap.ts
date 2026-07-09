import { serveStatic } from 'hono/bun';
import { secureHeaders } from 'hono/secure-headers';
import { Client } from 'langsmith';
import type { FeedbackSink, ModelGateway, RunMirror } from '@crisp/domain';
import { createApp } from './app';
import { loadEnv } from './infra/env';
import { LangsmithFeedbackSink } from './infra/langsmith-feedback-sink';
import { LangsmithRunMirror } from './infra/langsmith-run-mirror';
import { LangsmithTracingGateway } from './infra/langsmith-tracing-gateway';
import { RedisTokenBucket } from './middleware/rate-limit';
import { CSP_DIRECTIVES, cacheControlFor } from './infra/security';
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
  // Per-IP limits, unless the kill-switch is set (e2e, local load tests).
  const rateLimit = env.rateLimitEnabled
    ? { store: await RedisTokenBucket.connect(env.redisUrl) }
    : undefined;
  const { app, runManager } = createApp({
    env,
    registry,
    gateway,
    conversations,
    runStreams,
    feedback,
    runMirror,
    rateLimit,
    probes: {
      redis: () => runStreams.ping(),
      db: () => conversations.ping(),
    },
  });

  // Unknown API paths are 404s, not the SPA shell.
  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  if (env.staticDir) {
    // These middlewares are registered after the API routes, so they apply
    // to the static chain only. COOP/COEP stay off (frontend's spec).
    app.use(
      '*',
      secureHeaders({
        contentSecurityPolicy: CSP_DIRECTIVES,
        crossOriginOpenerPolicy: false,
        crossOriginEmbedderPolicy: false,
      }),
    );
    app.use('*', async (c, next) => {
      await next();
      if (c.res.ok)
        c.res.headers.set('cache-control', cacheControlFor(new URL(c.req.url).pathname));
    });
    app.use('*', serveStatic({ root: env.staticDir }));
    app.get('*', serveStatic({ path: `${env.staticDir}/index.html` }));
  }

  return { app, runManager };
};
