import { createClient } from 'redis';
import type { RunEvent, RunStreamStore } from '@crisp/domain';

const makeClient = (url: string) => createClient({ url });
type RedisClient = ReturnType<typeof makeClient>;

const RUN_TTL_SECONDS = 60 * 30;
const END_SENTINEL = '__RUN_END__';

const runKey = (runId: string) => `crisp:run:${runId}`;
const activeKey = (conversationId: string) => `crisp:active:${conversationId}`;

/**
 * RunStreamStore over Redis Streams (ADR-0001). Events append to a stream
 * per Run; replay() XRANGEs the backlog then block-reads the tail until the
 * end sentinel. Keys expire after 30 minutes — a Run is a live concern, not
 * an archive (SQLite owns durable history).
 */
export class RedisRunStreamStore implements RunStreamStore {
  constructor(private readonly client: RedisClient) {}

  static async connect(url: string): Promise<RedisRunStreamStore> {
    const client = makeClient(url);
    client.on('error', (error) => console.error('redis error', error));
    await client.connect();
    return new RedisRunStreamStore(client);
  }

  async append(runId: string, event: RunEvent): Promise<void> {
    const key = runKey(runId);
    await this.client.xAdd(key, '*', { e: JSON.stringify(event) });
    await this.client.expire(key, RUN_TTL_SECONDS);
  }

  async markFinished(runId: string): Promise<void> {
    const key = runKey(runId);
    await this.client.xAdd(key, '*', { e: END_SENTINEL });
    // The sentinel may be the first write of a zero-event Run — without this
    // the key would be created TTL-less and leak forever.
    await this.client.expire(key, RUN_TTL_SECONDS);
  }

  /** Health probe: throws when Redis is unreachable. */
  async ping(): Promise<void> {
    await this.client.ping();
  }

  async *replay(runId: string, signal?: AbortSignal): AsyncIterable<RunEvent> {
    const key = runKey(runId);
    let cursor = '0-0';

    // Backlog first: everything buffered so far.
    const backlog = await this.client.xRange(key, '-', '+');
    for (const entry of backlog) {
      const payload = entry.message.e;
      if (payload === END_SENTINEL) return;
      if (payload) yield JSON.parse(payload) as RunEvent;
      cursor = entry.id;
    }

    // Then tail live. Blocking reads monopolize a connection, so use a
    // dedicated one for the duration of this replay.
    const tail = this.client.duplicate();
    await tail.connect();
    try {
      while (!signal?.aborted) {
        const response = await tail.xRead({ key, id: cursor }, { BLOCK: 1000, COUNT: 64 });
        if (!response) {
          // Idle poll timeout — if the stream vanished (expired), stop.
          const exists = await tail.exists(key);
          if (!exists) return;
          continue;
        }
        for (const stream of response) {
          for (const entry of stream.messages) {
            const payload = entry.message.e;
            if (payload === END_SENTINEL) return;
            if (payload) yield JSON.parse(payload) as RunEvent;
            cursor = entry.id;
          }
        }
      }
    } finally {
      tail.destroy();
    }
  }

  async claimActiveRun(conversationId: string, runId: string): Promise<boolean> {
    // SET NX is the atomic check-and-set; the TTL bounds how long a crashed
    // process can keep a conversation locked.
    const reply = await this.client.set(activeKey(conversationId), runId, {
      condition: 'NX',
      expiration: { type: 'EX', value: RUN_TTL_SECONDS },
    });
    return reply === 'OK';
  }

  async releaseActiveRun(conversationId: string, runId: string): Promise<void> {
    // Compare-and-delete: only the claim holder may release, so a stale
    // release can never evict a successor Run's claim.
    await this.client.eval("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0", {
      keys: [activeKey(conversationId)],
      arguments: [runId],
    });
  }

  async activeRun(conversationId: string): Promise<string | null> {
    return this.client.get(activeKey(conversationId));
  }

  async close(): Promise<void> {
    this.client.destroy();
  }
}
