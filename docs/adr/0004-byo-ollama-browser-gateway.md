# Local models stay the user's own: the browser is their gateway

When Crisp is deployed, the server cannot reach a visitor's `localhost:11434` — but the page running in their browser can. Local models therefore execute through a client-side gateway: the browser discovers the user's Ollama (`/api/tags`), runs the generation itself via @crisp/ai's Ollama adapter in the page, and renders the same AG-UI event stream as server runs (ADR-0002 makes the transcript indifferent to where events come from). The user opts in once: `OLLAMA_ORIGINS=<app origin>` on their daemon plus Chrome's Local Network Access permission prompt. Finished BYO runs are persisted through the server, which is also where they enter observability — no telemetry credentials ever ship to the browser.

Rejected: a Railway-hosted Ollama service (dilutes "local" into "self-hosted", costs money, zero of the interview signal) and reverse tunnels (pushes install-and-security friction onto the user). Trade-off accepted: BYO runs cannot mid-stream resume after a reload — the run lives in the tab, not in Redis.

Status: accepted
