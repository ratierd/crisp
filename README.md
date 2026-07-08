# Crisp

A small, polished multi-AI chat client. Vue 3 SPA talking to a Hono API on Bun,
streaming LLM responses over the [AG-UI protocol](https://docs.ag-ui.com/) —
from remote providers (Anthropic, OpenAI, OpenRouter) and local ones (Ollama),
plus a zero-key **Demo** model so the app works the moment it starts.

![quiet editorial UI: typography-first, no chat bubbles, one accent color](docs/design/prototype.html)

## Run it

```sh
docker compose up --build
# → http://localhost:3000
```

That's the whole setup. Redis and the app start together; the Demo model needs
no keys. To light up real providers, run the interactive wizard (needs
[Bun](https://bun.sh)) — it collects provider and LangSmith keys into `.env`
(compose reads it automatically), validates them live, and helps you pull
your first local model:

```sh
bun install && bun setup
```

No Bun? Copy `.env.example` to `.env` and fill it by hand — everything in it
is optional. Inline env vars work too:
`ANTHROPIC_API_KEY=sk-... docker compose up --build`.

Remote models are also **BYOK**: a visitor pastes their own Anthropic, OpenAI,
or OpenRouter key into the model picker and chats on their own account
(ADR-0006). The key stays in that browser's localStorage, rides each request
next to the model id, is used for that Run, and is never stored or logged
server-side.

Local models are **BYO Ollama** — always discovered and run by the *browser*,
never the server, exactly as they would be against a deployed Crisp. On
localhost a running daemon just works (Ollama allows localhost origins by
default); every installed model appears in the picker. Against a deployed
instance, allow that origin on your daemon —

```sh
OLLAMA_ORIGINS=https://crisp.example.com ollama serve   # the picker shows your exact origin
```

— and your local models appear and run straight from the browser. On HTTPS
deployments Chrome asks once for local-network permission; that's the point.

To collect traces, cost, and feedback analytics in LangSmith, set
`LANGSMITH_API_KEY` (and optionally `LANGSMITH_PROJECT`) — see
[Observability](#architecture) below.

### Development

```sh
bun install
docker compose up redis -d
bun setup                   # optional: keys, LangSmith, first local model
bun dev                     # server :3000 + vite :5173
```

| command | what it does |
| --- | --- |
| `bun setup` | interactive wizard: keys → `.env` (idempotent, secrets masked), pull a local model |
| `bun dev` | dev servers (Hono on :3000, Vite on :5173) |
| `bun test` | unit + integration tests (Vitest) |
| `bun typecheck` | strict TS across all packages |
| `bun e2e` | Playwright smoke spec against the Demo model¹ |

¹ needs Redis running; on NixOS point it at a system browser:
`CRISP_E2E_BROWSER=$(which google-chrome-stable) bun e2e`.

### Environment variables

Everything is optional (`bun setup` fills these interactively; see
`.env.example` for the manual route):

| var | default | effect |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | enables Claude models in the picker |
| `OPENAI_API_KEY` | — | enables GPT models in the picker |
| `OPENROUTER_API_KEY` | — | enables OpenRouter models in the picker |
| `LANGSMITH_API_KEY` | — | traces every Run to LangSmith; feedback lands on traces |
| `LANGSMITH_PROJECT` | `crisp` | LangSmith project name |
| `LANGSMITH_ENDPOINT` | US host | set `https://eu.api.smith.langchain.com` for EU accounts |
| `REDIS_URL` | `redis://localhost:6379` | run-stream buffer (required) |
| `DB_PATH` | `./data/crisp.sqlite` | conversation storage |
| `PORT` | `3000` | API port |

## What it does

- **Streaming chat** over AG-UI events (SSE), with markdown + Shiki-highlighted
  code blocks rendered incrementally — only the growing tail block re-renders.
- **Model picker with health gating**: `GET /api/models` doubles as a health
  check; a dead provider's models stay visible but disabled, with a hint
  explaining why (missing key), and the picker shows the one-line command
  that connects your own Ollama.
- **BYOK — bring your own key**: paste your Anthropic / OpenAI / OpenRouter
  key in the picker and the disabled models light up; your chats (and their
  auto-titles) bill your account. Keys live in your browser only, travel
  per-request, and are never persisted or logged server-side (ADR-0006).
- **Mid-stream resume**: refresh the page while the model is answering and the
  stream reattaches and keeps writing. Runs execute detached from the HTTP
  request; a dropped connection doesn't kill generation.
- **Stream controls**: stop (Esc), regenerate, retry on typed error cards
  (`provider_unavailable` / `auth_failed` / `rate_limited` / `aborted` / `unknown`).
- **Conversations**: SQLite-persisted history, auto-titled after the first
  exchange by the model that answered.
- **BYO Ollama**: local models are always the *browser's* job — it discovers
  and runs the user's own daemon directly, in dev and deployed alike; the
  model list, streaming, stop, regenerate, and feedback all work identically
  to server runs. The picker shows the one-line `OLLAMA_ORIGINS` command
  that opts your daemon in (localhost origins need no config).
- **Observability (LangSmith)**: set `LANGSMITH_API_KEY` and every Run —
  remote, local, demo, stopped, failed — becomes a trace with token usage and
  cost; conversations group as Threads; thumbs up/down (with an optional
  "what went wrong" note) attaches to the exact trace as feedback.
- **Feedback**: 👍/👎 on every answer — toggleable, retractable, per
  regeneration attempt, persisted with the message.
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

Five ports carry all the IO ([CONTEXT.md](CONTEXT.md) has the vocabulary):

| port | job | adapter |
| --- | --- | --- |
| `ModelGateway` | start a Run against any Model, regardless of Provenance | `@crisp/ai` provider adapters + mock Demo provider, wrapped by a LangSmith tracing decorator when the key is set |
| `ConversationRepository` | durable Conversations | `bun:sqlite` |
| `RunStreamStore` | buffer live Run events for reattach | Redis Streams |
| `FeedbackSink` | mirror thumbs votes to observability | LangSmith feedback API |
| `RunMirror` | record browser-executed (BYO) Runs post-hoc | LangSmith run API |

Observability never touches the domain: tracing is a *decorator* on
`ModelGateway`, so without `LANGSMITH_API_KEY` the app composes exactly as it
did before the feature existed.

The flow for one message: the client POSTs the AG-UI payload to `/api/chat`.
The server starts the Run **detached**, teeing every event into Redis; the
HTTP response merely replays that stream. On completion the exchange is
persisted to SQLite. If the client vanishes mid-run, the run finishes anyway —
reloading replays the buffered events and tails the rest live.

### Decisions & tradeoffs

Recorded as they were made, in [docs/adr/](docs/adr/) and
[docs/plan.md](docs/plan.md). The ones worth calling out:

- **AG-UI events cross the hexagon untranslated** (ADR-0002). AG-UI is an open
  protocol, not a vendor SDK type — translating it to "domain events" and back
  in the riskiest code path (stream handling) would be busywork with bug
  surface. The domain only inspects event discriminants.
- **Redis for resumable runs** (ADR-0001). An in-process buffer would demo the
  same thing with zero infrastructure; Redis was chosen deliberately to make
  resumability a first-class, multi-instance-ready concern rather than a demo
  trick. The cost — a hard dependency — is mitigated by the one-command compose
  setup.
- **Local models stay the user's own** (ADR-0004). A deployed server can
  never reach a visitor's `localhost:11434` — but the page can. All local
  models execute through a client-side gateway emitting the same AG-UI
  events, and the finished run is reported to the server for persistence and
  tracing. There is deliberately no server-side Ollama path: it would only
  ever work in dev, making dev exercise a code path production never would.
  Accepted degradation: BYO runs can't mid-stream resume after a reload.
- **LangSmith over first-party analytics** (ADR-0005). Usage, cost, failures,
  and user feedback live in LangSmith rather than a home-built dashboard —
  one flat `llm` trace per Run whose id *is* the Run's id, conversations
  grouped as Threads. Deliberate trade: conversations with local models leave
  the machine. A first-party run ledger was designed and rejected.

Other tradeoffs, honestly:

- **The AI client is in-house** (`libs/ai`, ADR-0003). One workspace lib
  carries the provider adapters, the AG-UI envelope, and the useChat
  composable; provider wire formats are ours to track, contained behind
  `ModelGateway`.
- **The error taxonomy is pattern-matched** from provider messages/codes.
  Providers don't agree on error shapes; the patterns cover the common cases
  and everything else degrades to a working `unknown` card.
- **No hosted URL yet.** `docker compose up` is the deployment story today.
  BYO Ollama exists precisely so a hosted Crisp wouldn't fake its local-model
  support: deploy the container (e.g. Railway: app + Redis + a volume for
  SQLite), and visitors connect their *own* Ollama with one env var.
- **Shiki's dual themes** (`min-light`/`min-dark`) ride the same
  `light-dark()` mechanism as the app tokens, rather than being remapped
  to the exact brand code palette — one mechanism, close-enough colors.

### Testing

- **Domain** (Vitest): services against in-memory port fakes — run lifecycle,
  abort-with-partial, error paths, title fallback/sanitization.
- **API** (Vitest): the real Hono app with the mock provider — SSE happy path,
  typed errors, detached-run resume, stop-persists-partial, regenerate-replaces,
  feedback vote/retract, BYO-run persistence + mirroring.
- **Tracing** (Vitest): the LangSmith gateway decorator against a fake client —
  completed/stopped/failed/consumer-break outcomes, usage mapping, and that a
  dead LangSmith never disturbs the stream.
- **E2E** (Playwright, one local spec): empty state → streamed markdown →
  conversation listed; error card; stop/regenerate; and refresh-mid-run resume.
  Deterministic because it runs on the Demo model.

## With more time

- Tool calls (the AG-UI event vocabulary and message `parts` already carry them).
- A `live: true` subscription mode in `@crisp/ai` instead of the hand-rolled
  replay reader.
- Message editing with history forking; shareable conversation links.
- Virtualized transcript for very long conversations.
- A second `RunStreamStore` adapter (in-process) to drop the Redis requirement
  for single-instance deployments.
