# User-supplied provider keys pass through per-request (BYOK)

A deployed Crisp should not bill the operator for every visitor's chats, and a
visitor should not need the operator's permission to use Claude, GPT, or an
OpenRouter model — they bring their own key. The key is pasted into the model
picker, lives in that browser's `localStorage` only, and rides each chat
request inside `forwardedProps` next to the model id. Server-side it flows
`route → RunManager → RunService → ModelGateway` as an opaque
`StartRunOptions.apiKey` that takes precedence over the env key, exists only
for the lifetime of the Run (title generation reuses it, so the same account
pays for its own titles), and is never persisted, logged, or forwarded to
observability — the LangSmith decorator traces model, messages, and usage,
not options it doesn't understand. `/api/models` still reports env-gated
availability honestly; the *client* upgrades a model to available when it
holds a key for that provider, and `POST /api/chat` accepts an env-unavailable
model when the request carries a key.

Alternatives rejected: browser-direct provider calls (OpenAI blocks browser
origins, key handling would fork the gateway into two runtimes, and server
features — resume, persistence, tracing — would fork with it); server-side
key storage with sessions (a credential store is the last thing this server
should grow — holding keys at rest demands encryption, rotation, and deletion
stories that per-request pass-through simply doesn't have). Accepted trade:
the key transits the server on every send (TLS-protected, body not headers,
so it never lands in access logs), and clearing the browser clears the key.

Status: accepted
