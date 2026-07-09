# Crisp — features & user flows

A guided tour for anyone evaluating the product: what Crisp does, how each
flow behaves step by step, and where the behavior is locked down by tests.
Architecture and rationale live in the [README](../README.md) and
[docs/adr/](adr/); this document is about what a user experiences.

Everything below works with **zero API keys** via the built-in Demo model
unless a flow says otherwise. (Deployed instances hide the Demo model with
`CRISP_DEMO=off` — there, connect OpenRouter in one click, use your own
Ollama, or paste a provider key.)

## 1. At a glance

| Feature                                                    | Where                     | Locked down by                                              |
| ---------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| Streaming chat over AG-UI events (SSE)                     | composer → transcript     | `app.test.ts`, e2e `smoke.spec.ts`                          |
| Incremental markdown + Shiki code blocks, copy button      | assistant messages        | `markdown.test.ts`, e2e                                     |
| Model picker with health gating + reasons                  | top bar                   | `app.test.ts` (models route), `stores/app.test.ts`          |
| BYOK: paste your own Anthropic/OpenAI/OpenRouter key       | picker key inputs         | `keys.test.ts`, `stores/app.test.ts`, `ai-gateway.test.ts`  |
| BYO Ollama: your local models, run by your browser         | picker + one-line command | `byo.test.ts`, `app.test.ts` (byo-runs)                     |
| Mid-stream resume after refresh / reconnect                | automatic                 | `app.test.ts` (resume), e2e                                 |
| Stop (Esc), regenerate, retry on typed error cards         | message affordances       | `run-service.test.ts`, `regenerate.test.ts`, e2e            |
| One live run per conversation (atomic claim → 409)         | server                    | `app.test.ts` (claim race), `visitor-scoping-edges.test.ts` |
| Conversations: SQLite-persisted, auto-titled, per-visitor  | sidebar                   | `conversation-repository.contract.bun.ts`, scoping tests    |
| Feedback 👍/👎 with optional note, retractable             | under each answer         | `app.test.ts` (feedback)                                    |
| Latency badge: time-to-first-token · chunks/s              | under each answer         | `byo.test.ts` (stats math), e2e                             |
| Observability: every run a LangSmith trace, threads, votes | `LANGSMITH_API_KEY`       | `langsmith-tracing-gateway.test.ts`                         |
| Guardrails: rate limits, body caps, CSP, honest health     | server                    | `rate-limit.test.ts`, `security.test.ts`                    |
| Dark/light theme (OKLCH tokens), responsive to mobile      | top bar toggle            | CSP hash contract in `security.test.ts`                     |

## 2. Flows

### 2.1 First message → streamed answer → titled conversation

1. Open the app: an empty state ("Start a conversation.") and a composer.
2. Type a message, press **Enter**. The user message renders immediately;
   the top bar shows **run live**; the send button becomes **Stop**.
3. The answer streams in as markdown — paragraphs, headings and code blocks
   appear incrementally (only the growing tail block re-renders; a final
   whole-document render happens once the run finishes).
4. On completion a latency badge appears under the answer:
   `2.1s to first token · 38 chunks/s · <model>`.
5. The conversation appears in the sidebar; a moment later its title is
   replaced by a model-written one (the same model that answered — with your
   key, if the run used BYOK).

_Try it on the Demo model with:_ `walk me through markdown`.

### 2.2 Typed error → retry

1. Any provider failure ends the run with a **typed error card**, not a toast:
   a headline, a plain-language explanation naming the provider, the error
   kind (`rate_limited`, `auth_failed`, `provider_unavailable`, `aborted`,
   `unknown`), and a **Retry** button.
2. Retry re-runs the same user message in place (it is the regenerate path
   under the hood — no duplicate user message, the failed attempt is
   superseded).

_Try it on the Demo model:_ include `error:rate_limited` (or any other kind)
in your message.

### 2.3 Stop mid-stream → keep the partial → regenerate

1. While a run is live, press **Esc** (or click Stop).
2. The partial answer is kept and marked **▪ stopped early**; nothing is lost.
3. A **regenerate** affordance appears under the message; regenerating
   replaces the superseded answer instead of appending a second one.

### 2.4 Refresh mid-stream → the answer keeps writing

1. Send a message; while the answer is streaming, reload the page.
2. History is restored, and the live stream reattaches and writes to
   completion — runs execute detached on the server, addressed by a
   server-minted run id, so a dropped connection never kills generation.
3. The same applies to a second tab, or to sending from a flaky network.

Note: BYO-Ollama runs execute in the browser and are the one exception — a
refresh ends them (ADR-0004).

### 2.5 One conversation, one live run

Sending twice concurrently (double-click, two tabs) can't fork a
conversation: the server takes an atomic claim per conversation; the loser
gets **409 — a run is already live**. The claim is released on every exit
path (finish, stop, error), after which sending works again.

### 2.6 Bring your own key (BYOK)

1. Open the model picker: providers without a server-side key show their
   models greyed out with the reason (e.g. "OPENAI_API_KEY missing").
2. Paste your own key into the provider's input (a link to each provider's
   key console is right there). The models light up.
3. Your chats — and their auto-titles — now bill your account. The key lives
   in this browser's `localStorage` only, travels once per request, is used
   for that run, and is never persisted, logged, or attached to traces.
   A user key always wins over the server's key.
4. Clear the input to remove the key; availability reverts.

### 2.7 Bring your own Ollama

1. On localhost, the browser probes your local daemon automatically; your
   models appear in the picker under **Ollama (yours)**.
2. On a deployed origin the picker shows the one-time opt-in command
   (`OLLAMA_ORIGINS=<origin> ollama serve`); opening the picker re-probes.
   Once connected ever, this browser auto-probes on future visits — visitors
   without Ollama never pay a probe (or see its CORS noise).
3. BYO models run **in the page**: the browser streams straight from your
   daemon, emitting the same events server runs do — stop, regenerate,
   feedback, latency badge all work identically.
4. Finished runs are reported to the server for history and observability;
   reports are idempotent (a retried report never duplicates the exchange).
   See [docs/byo-ollama.md](byo-ollama.md) and the in-app `/byo-ollama.html`.

### 2.8 Feedback

1. Every assistant answer carries 👍/👎. A down-vote offers an optional
   "what went wrong" note.
2. Votes are per regeneration attempt, toggleable, and retractable (click
   the active thumb again).
3. Votes persist with the message and — when LangSmith is configured —
   attach to the exact trace of the run they judge.

### 2.9 Your conversations are yours

Visitors are scoped by an anonymous, HttpOnly session cookie. Listing,
opening, deleting, and voting only work on your own conversations; another
visitor's requests against your conversation ids get 404s/no-ops/409s, never
data. There are no accounts and nothing to configure.

## 3. Keyboard & affordances

| Input               | Effect                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `Enter`             | send                                                                      |
| `Shift+Enter`       | newline                                                                   |
| `Esc`               | stop the live run · close the model picker (focus returns to the trigger) |
| `⌘K` / `Ctrl+K`     | new conversation                                                          |
| code block **copy** | copies the source                                                         |
| sidebar edge drag   | resize (250–600 px); collapses on narrow screens (< 780 px)               |
| theme toggle        | dark/light; follows the system until you choose                           |

## 4. Error taxonomy

| Kind                   | Meaning                                   | Card behavior                               |
| ---------------------- | ----------------------------------------- | ------------------------------------------- |
| `provider_unavailable` | network/daemon/5xx — provider unreachable | explains, offers Retry                      |
| `auth_failed`          | key missing/invalid at the provider       | points at the key, offers Retry             |
| `rate_limited`         | 429/quota/overloaded                      | asks for patience, offers Retry             |
| `aborted`              | you stopped it                            | partial kept, no Retry (regenerate instead) |
| `unknown`              | anything unrecognized                     | generic copy, offers Retry                  |

Classification is centralized (`classify-error.ts`) and corpus-tested
against real provider strings.

## 5. Guardrails (server)

- **Honest health**: `GET /api/health` → `{ ok, redis, db, startedAt }`,
  HTTP 503 when degraded. Chat needs Redis; history needs SQLite.
- **Rate limiting**: per-IP token buckets per route class; 429 with
  `Retry-After` and a typed `rate_limited` body; fails open if the bucket
  store is down; `CRISP_RATE_LIMIT=off` kill switch (used by tests).
- **Input caps**: hard body-size ceiling (413) plus zod caps on message
  count and field sizes (400).
- **Run addressing**: run ids are server-minted UUID capabilities — clients
  cannot choose or predict them; feedback is additionally owner-scoped.
- **Headers**: strict CSP (inline theme snippet hash-pinned by a
  cross-package test), immutable caching for hashed assets, `no-store` for
  API responses.

## 6. Intentionally out of scope

See the README's "With more time": tool calls, message editing/forking,
shareable links, transcript virtualization, an in-process RunStreamStore
adapter. Also, deliberately: no accounts (anonymous session scoping is the
product decision), and no server-side Ollama (ADR-0004 — a deployed server
can never reach your localhost anyway).

## 7. Evaluator quickstart (5 minutes, zero keys)

```sh
bun install
docker compose up redis -d
bun dev            # server :3000 + web :5173
```

1. Open http://localhost:5173 → send `walk me through markdown` → watch
   streaming markdown, code highlighting, the latency badge, the auto-title.
2. Send `please error:rate_limited now` → typed error card → Retry.
3. Send the markdown prompt again; press **Esc** mid-answer → `▪ stopped
early` + regenerate.
4. Send it once more and **reload mid-stream** → the answer keeps writing.
5. Have Ollama? `ollama serve` locally and open the model picker — your
   models are already there. Chat locally; stop/regenerate/vote as usual.
6. Then run what CI runs: `bun run typecheck && bun run coverage && bun nx
run-many -t test-contract`, and the e2e suite (needs Redis on 6379):
   `bun e2e` (on NixOS: `CRISP_E2E_BROWSER=$(which google-chrome-stable) bun e2e`).
