import { defineRailway, preserve, project, redis, service, volume } from 'railway/iac';

/**
 * Crisp on Railway — the whole topology, tracked in code. `railway config
 * plan` diffs this file against the live project (exit 2 = drift);
 * `railway config apply` converges. Idempotent by construction.
 *
 * The app service has no `source`: code ships from this repo with
 * `railway up --service crisp`, which builds the root Dockerfile. Railway
 * injects PORT; the server reads it (apps/server/src/infra/env.ts).
 * Secret values (LANGSMITH_*) live on Railway only — `preserve()` keeps
 * them out of source; set them once with
 * `railway variable set LANGSMITH_API_KEY --stdin --service crisp`.
 */
export default defineRailway(() => {
  const Redis = redis('Redis');
  // pin the Railway redis template's start command (auth + persistence);
  // without it the differ proposes unsetting it, which would break AUTH
  Redis.deploy = {
    startCommand:
      '/bin/sh -c "rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH"',
  };
  const redisVolume = volume('redis-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'sfo',
    sizeMB: 500,
  });

  // SQLite lives here — one replica by design (ADR-0001 keeps multi-instance
  // concerns in Redis; conversation storage stays simple).
  const crispVolume = volume('crisp-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'sfo',
    sizeMB: 500,
  });

  const crisp = service('crisp', {
    replicas: 1,
    healthcheck: '/api/health',
    healthcheckTimeout: 120,
    volumeMounts: {
      '/data': crispVolume,
    },
    // All values preserve(): the plan engine can't compare declared values
    // against live ones (they render «hidden»), so literals would re-diff on
    // every plan. Live values, for the record:
    //   DB_PATH   = /data/crisp.sqlite
    //   REDIS_URL = ${{Redis.REDIS_URL}}
    //   LANGSMITH_* = secrets, set via `railway variable set … --stdin`
    env: {
      DB_PATH: preserve(),
      REDIS_URL: preserve(),
      LANGSMITH_API_KEY: preserve(),
      LANGSMITH_ENDPOINT: preserve(),
      LANGSMITH_PROJECT: preserve(),
    },
  });

  return project('crisp', {
    resources: [crisp, Redis, redisVolume, crispVolume],
  });
});
