# Crisp

A small, polished multi-AI chat client. Vue 3 SPA talking to a Hono API on Bun,
streaming LLM responses over the [AG-UI protocol](https://docs.ag-ui.com/) —
from remote providers (Anthropic, OpenAI) and local ones (Ollama), plus a
zero-key **Demo** model so the app works the moment it starts.

![quiet editorial UI: typography-first, no chat bubbles, one accent color](docs/design/prototype.html)

## Run it

```sh
docker compose up --build
# → http://localhost:3000
```

That's the whole setup. Redis and the app start together; the Demo model needs
no keys. To light up real providers, pass keys through the environment
(compose forwards them):

```sh
ANTHROPIC_API_KEY=sk-... OPENAI_API_KEY=sk-... docker compose up --build
```

A local Ollama daemon on the host is picked up automatically
(`host.docker.internal:11434`); every installed model appears in the picker.

### Development

```sh
bun install
docker compose up redis -d
cp .env.example .env        # optional: add provider keys
bun dev                     # server :3000 + vite :5173
```

| command | what it does |
| --- | --- |
| `bun dev` | dev servers (Hono on :3000, Vite on :5173) |
| `bun test` | unit + integration tests (Vitest) |
| `bun typecheck` | strict TS across all packages |
| `bun e2e` | Playwright smoke spec against the Demo model¹ |

¹ needs Redis running; on NixOS point it at a system browser:
`CRISP_E2E_BROWSER=$(which google-chrome-stable) bun e2e`.

### Environment variables

Everything is optional (see `.env.example`):

| var | default | effect |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | enables Claude models in the picker |
| `OPENAI_API_KEY` | — | enables GPT models in the picker |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | where to discover local models |
| `REDIS_URL` | `redis://localhost:6379` | run-stream buffer (required) |
| `DB_PATH` | `./data/crisp.sqlite` | conversation storage |
| `PORT` | `3000` | API port |

## What it does

- **Streaming chat** over AG-UI events (SSE), with markdown + Shiki-highlighted
  code blocks rendered incrementally — only the growing tail block re-renders.
- **Model picker with health gating**: `GET /api/models` doubles as a health
  check; a dead provider's models stay visible but disabled, with a hint
  explaining why (missing key, Ollama not running).
- **Mid-stream resume**: refresh the page while the model is answering and the
  stream reattaches and keeps writing. Runs execute detached from the HTTP
  request; a dropped connection doesn't kill generation.
- **Stream controls**: stop (Esc), regenerate, retry on typed error cards
  (`provider_unavailable` / `auth_failed` / `rate_limited` / `aborted` / `unknown`).
- **Conversations**: SQLite-persisted history, auto-titled after the first
  exchange by the model that answered.
- **Polish pack**: dark/light from one OKLCH token set (`light-dark()`),
  keyboard shortcuts (Enter / Shift+Enter / Esc / ⌘K), per-message latency
  badges (time-to-first-token · tok/s), responsive down to mobile.

## Architecture

Nx monorepo, pragmatic hexagonal. The domain knows *what* a chat app does;
adapters know *how* tonight's infrastructure does it.

```
apps/
  web/       Vue 3 + Vite SPA — @crisp/ai/vue useChat, Pinia for app state
  server/    Hono on Bun — routes + infra adapters
    src/infra/   ModelRegistry, @crisp/ai gateway, bun:sqlite repo, Redis Streams store
libs/
  ai/        in-house AG-UI client (ADR-0003): chat orchestrator, provider adapters, SSE, useChat
  contracts/ zod schemas shared by both sides (Model, Message, error taxonomy)
  domain/    entities + ports + services, no IO
```

Three ports carry all the IO ([CONTEXT.md](CONTEXT.md) has the vocabulary):

| port | job | adapter |
| --- | --- | --- |
| `ModelGateway` | start a Run against any Model, regardless of Provenance | `@crisp/ai` provider adapters + mock Demo provider |
| `ConversationRepository` | durable Conversations | `bun:sqlite` |
| `RunStreamStore` | buffer live Run events for reattach | Redis Streams |

The flow for one message: the client POSTs the AG-UI payload to `/api/chat`.
The server starts the Run **detached**, teeing every event into Redis; the
HTTP response merely replays that stream. On completion the exchange is
persisted to SQLite. If the client vanishes mid-run, the run finishes anyway —
reloading replays the buffered events and tails the rest live.

### Decisions & tradeoffs

Recorded as they were made, in [docs/adr/](docs/adr/) and
[docs/plan.md](docs/plan.md). The two worth calling out:

- **AG-UI events cross the hexagon untranslated** (ADR-0002). AG-UI is an open
  protocol, not a vendor SDK type — translating it to "domain events" and back
  in the riskiest code path (stream handling) would be busywork with bug
  surface. The domain only inspects event discriminants.
- **Redis for resumable runs** (ADR-0001). An in-process buffer would demo the
  same thing with zero infrastructure; Redis was chosen deliberately to make
  resumability a first-class, multi-instance-ready concern rather than a demo
  trick. The cost — a hard dependency — is mitigated by the one-command compose
  setup.

Other tradeoffs, honestly:

- **The AI client is in-house** (`libs/ai`, ADR-0003). One workspace lib
  carries the provider adapters, the AG-UI envelope, and the useChat
  composable; provider wire formats are ours to track, contained behind
  `ModelGateway`.
- **The error taxonomy is pattern-matched** from provider messages/codes.
  Providers don't agree on error shapes; the patterns cover the common cases
  and everything else degrades to a working `unknown` card.
- **No hosted URL.** Half the product is a local model and a Redis-backed
  resume path — a hosted demo without them would misrepresent the project.
  `docker compose up` is the deployment story.
- **Shiki's dual themes** (`min-light`/`min-dark`) ride the same
  `light-dark()` mechanism as the app tokens, rather than being remapped
  to the exact brand code palette — one mechanism, close-enough colors.

### Testing

- **Domain** (Vitest): services against in-memory port fakes — run lifecycle,
  abort-with-partial, error paths, title fallback/sanitization.
- **API** (Vitest): the real Hono app with the mock provider — SSE happy path,
  typed errors, detached-run resume, stop-persists-partial, regenerate-replaces.
- **E2E** (Playwright, one local spec): empty state → streamed markdown →
  conversation listed; error card; stop/regenerate; and refresh-mid-run resume.
  Deterministic because it runs on the Demo model.

## With more time

- Tool calls (the AG-UI event vocabulary and message `parts` already carry them).
- A `live: true` subscription mode in `@crisp/ai` instead of the hand-rolled
  replay reader.
- Message editing with history forking; shareable conversation links.
- Cost tracking per Run (the `RUN_FINISHED` usage payload is already there).
- Virtualized transcript for very long conversations.
- A second `RunStreamStore` adapter (in-process) to drop the Redis requirement
  for single-instance deployments.
