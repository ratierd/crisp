import type { Hono } from 'hono';
import type { ModelRegistry } from '@crisp/models';
import type { AppEnv, Guard } from '../app';

export interface ModelRoutesDeps {
  guard: Guard;
  registry: ModelRegistry;
}

export const registerModelRoutes = (app: Hono<AppEnv>, deps: ModelRoutesDeps) => {
  app.get('/api/models', deps.guard('read'), async (c) =>
    c.json({ models: await deps.registry.listModels() }),
  );
};
