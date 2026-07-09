# Crisp — Design Plan

Interview exercise: a small, polished multi-AI chat client. 2-day hard timebox.
Domain language lives in [CONTEXT.md](../CONTEXT.md); decisions with real tradeoffs in [docs/adr/](./adr/).

## Decisions (grilled 2026-07-08)

| Area              | Decision                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope             | Required features + stream controls (stop/regenerate) + conversations (list, persistence) + polish pack (dark mode, shortcuts, responsive, latency). Tool calls only as day-2 stretch.                                                                                                                |
| Runtime / tooling | Bun + Nx monorepo                                                                                                                                                                                                                                                                                     |
| Frontend          | Vue 3 + Vite SPA, `@crisp/ai/vue` `useChat` (AG-UI over SSE). Pinia for app state (conversation list, model picker, theme); live chat state stays in `useChat`.                                                                                                                                       |
| Backend           | Hono on Bun — Web-standard `Response` returns @crisp/ai's SSE stream directly                                                                                                                                                                                                                         |
| Architecture      | Pragmatic hexagonal. `libs/domain` (entities + ports + services, no IO), `libs/contracts` (shared zod schemas), adapters in `apps/server/src/infra`. AG-UI events cross ports untranslated (ADR-0002).                                                                                                |
| Ports → adapters  | `ModelGateway` → @crisp/ai adapters; `ConversationRepository` → bun:sqlite; `RunStreamStore` → Redis Streams (ADR-0001)                                                                                                                                                                               |
| Providers         | Ollama (local, small default model) + Anthropic + OpenAI, gated by env-key presence, plus a `mock` "Demo" provider streaming canned markdown (used by tests, works with zero keys). Client fetches `GET /api/models`; picker sends `modelId` via `forwardedProps`; server validates against registry. |
| Persistence flow  | Server tees the run stream: client + Redis. On RUN_FINISHED, persist messages to SQLite. Conversation switch seeds `useChat` via `initialMessages`. Mid-stream refresh: SQLite history + Redis replay, then live.                                                                                     |
| Markdown          | markdown-it + Shiki (dual light/dark themes) + DOMPurify. Block-level memoization; only the growing tail block re-renders; plain `<pre>` while a fence is unclosed.                                                                                                                                   |
| Errors            | Typed taxonomy in contracts (`provider_unavailable`, `auth_failed`, `rate_limited`, `aborted`, `unknown`) carried by AG-UI `RUN_ERROR`. Inline error card with Retry at point of failure. `/api/models` doubles as health check → dead providers disabled in picker with hint.                        |
| Styling           | Vanilla modern CSS: `tokens.css` (OKLCH, `light-dark()`, `color-scheme`, `clamp()` scales), scoped SFC styles, container queries for sidebar, `field-sizing: content` composer. No Tailwind.                                                                                                          |
| Visual direction  | Quiet editorial: typography-first, one OKLCH accent, assistant messages as plain prose (no bubbles), collapsible sidebar. Markdown is the hero.                                                                                                                                                       |
| Testing           | Vitest: domain services vs in-memory port fakes; Hono integration test (happy/error/resume paths, fake gateway); markdown edge cases. Playwright: one local smoke spec against the mock provider.                                                                                                     |
| Deployment        | `docker compose up` (app + Redis, healthchecks) is the deliverable; dev = `docker compose up redis -d && bun dev`. No hosted URL — README explains why (local model + Redis make a hosted demo half the product).                                                                                     |

## Asserted details (unchallenged, revisit if wrong)

- Conversation auto-titles: fire-and-forget generation with the selected model after first exchange; fallback = truncated first message.
- Shortcuts: Enter send, Shift+Enter newline, Esc stop, Cmd/Ctrl+K new conversation.
- Latency: time-to-first-token + tokens/sec shown subtly per assistant message.
- The AI streaming lib is in-house (@crisp/ai) — keep its surface to exactly what Crisp uses.

## Day plan

**Day 1 — make it work end to end**

1. Nx workspace, apps/libs skeleton, compose file (Redis), tooling.
2. Contracts + domain (entities, ports, services) with unit tests.
3. Infra adapters: registry + mock provider, SQLite repo, Redis stream store.
4. Hono routes: `/api/chat` (AG-UI SSE), `/api/models`, conversations CRUD; integration test.
5. Vue shell: useChat wired to mock provider, raw message list — walking skeleton by end of day.

**Day 2 — make it good**

1. Real providers (Ollama, Anthropic, OpenAI) + health gating.
2. Mid-stream resume path (Redis replay + `live`).
3. Markdown renderer + Shiki + tests.
4. UI polish: tokens, editorial layout, dark mode, sidebar, shortcuts, latency badges, error cards.
5. Playwright smoke, README (architecture, tradeoffs, env vars, "with more time"), compose hardening, demo pass.

**Cut lines if behind:** mid-stream resume degrades to reconnect-shows-persisted-partial; latency badges; auto-titles.
