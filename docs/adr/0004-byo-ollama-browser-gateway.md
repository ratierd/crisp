# Local models stay the user's own: the browser is their gateway

When Crisp is deployed, the server cannot reach a visitor's `localhost:11434` — but the page running in their browser can. Local models therefore execute through a client-side gateway: the browser discovers the user's Ollama (`/api/tags`), runs the generation itself via @crisp/ai's Ollama adapter in the page, and renders the same AG-UI event stream as server runs (ADR-0002 makes the transcript indifferent to where events come from). The user opts in once: `OLLAMA_ORIGINS=<app origin>` on their daemon plus Chrome's Local Network Access permission prompt. Finished BYO runs are persisted through the server, which is also where they enter observability — no telemetry credentials ever ship to the browser.

Rejected: a Railway-hosted Ollama service (dilutes "local" into "self-hosted", costs money, zero of the interview signal) and reverse tunnels (pushes install-and-security friction onto the user). Trade-off accepted: BYO runs cannot mid-stream resume after a reload — the run lives in the tab, not in Redis.

Amended (2026-07-08): the server-side Ollama path (daemon discovery via `OLLAMA_BASE_URL`, `ollama/` models run by the server) is removed entirely. It only ever worked when the server and the daemon shared a machine — a dev-only situation — so keeping it meant local dev exercised a code path production never would. The browser gateway is now the *only* way local models run; dev and deployed Crisp behave identically. Localhost origins are allowed by Ollama's defaults, so local dev still needs zero daemon config.

Trust boundary: a reported BYO run is unauthenticated client input — the server persists what the browser *claims* happened. Accepted deliberately (the alternative is proxying local models through the server, which this ADR exists to reject), and bounded: runIds are deduped, the body cap limits payload size, and the endpoint sits behind the per-IP rate limit.

Status: accepted
