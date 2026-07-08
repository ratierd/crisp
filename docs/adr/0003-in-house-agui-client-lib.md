# The AG-UI client lib is written in-house (@crisp/ai)

The chat streaming stack (provider adapters, AG-UI event orchestration, SSE
transport, Vue chat composable) is one workspace lib, `libs/ai` (`@crisp/ai`),
written for exactly the surface Crisp uses. This is tractable — and cheap to
maintain — precisely because of ADR-0002: AG-UI events are the app's lingua
franca, so the lib only has to normalize four provider streams (Anthropic
Messages SSE, OpenAI chat-completions SSE, OpenAI-compatible/OpenRouter,
Ollama NDJSON) into events the rest of the system already speaks, plus a
fetch-SSE connection and a thin Vue binding. Text-only chat is in scope;
tools, reasoning streams, structured output, and multimodal parts — surface
Crisp doesn't use — are deliberately not.

Alternatives rejected: adopting a framework AI SDK (the mainstream options
were alpha-grade and churning release-to-release when Crisp started — a
pinned-alpha dependency in the riskiest code path; the used surface is small
enough that owning it costs less than tracking someone else's alpha).
Accepted trade: provider wire-format changes are ours to absorb — mitigated
by the adapters being ~100 lines each against stable public APIs, with the
behavior pinned by the gateway/byo unit tests and the Playwright flows.

Status: accepted
