import { createProductionApp } from './bootstrap';

const { app } = await createProductionApp();
const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  idleTimeout: 0, // runs can stream for minutes
  fetch: app.fetch,
});

console.log(`crisp server listening on http://localhost:${server.port}`);
