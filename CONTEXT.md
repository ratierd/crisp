# Crisp — Multi-AI Chat Client

A small, polished AI chat client: a Vue SPA talking to a Hono API that streams LLM responses (remote or local) over the AG-UI protocol.

## Language

**Conversation**:
A persisted thread of Messages, owned by the server (SQLite). Has a title and an ordered message history.
_Avoid_: Chat, thread, session

**Message**:
A single user or assistant entry within a Conversation, composed of parts (text, thinking, tool calls) per the AG-UI model.

**Run**:
One generation attempt by a model in response to the Conversation state. While live, its event stream is buffered in the RunStreamStore so clients can reattach mid-generation.
_Avoid_: Generation, completion, request

**Model**:
A concrete LLM a Run can target, described by registry metadata (id, display name, provenance, capabilities).

**Wire Message**:
A Message in the loose shape it crosses the AG-UI wire — in the chat request and in the BYO run report. Only its role and text content are meaningful to the rest of the system; everything else rides along untranslated (ADR-0002).
_Avoid_: Raw message, wire format, payload message

**Feedback**:
The user's thumbs-up/down verdict on a Run, given from the assistant Message it produced. Attached to the Run's id in LangSmith.
_Avoid_: Rating, vote, reaction

**Provenance**:
Where a Model executes: `local` (the user's own machine — their Ollama, always reached directly from the browser) or `remote` (a third-party API, e.g. Anthropic, OpenAI, OpenRouter). A property of the Model, invisible to the domain logic.
_Avoid_: Provider type, origin, self-hosted

**BYOK**:
Bring-your-own-key: a user-supplied provider API key that rides a chat request, makes an env-unavailable remote Model usable for that Run, and is billed to the user's own account. Acquired by pasting from the provider's console or minted in one click via OpenRouter's connect flow. Held in the user's browser, passed through the server per-request, never stored there.
_Avoid_: User token, credential, session key

**Feature Slice**:
The unit of ownership: one user-visible capability (conversations, runs, titling, feedback, models) owning its contracts, its ports, and its behavior. Other slices reach it through its contracts only (ADR-0008).
_Avoid_: Layer, module, subdomain

**ModelGateway**:
The runs slice's port for starting a Run against any Model, regardless of Provenance. Titling declares its own narrower TitleModel port; one adapter (wrapping the in-house @crisp/ai provider adapters, ADR-0003) satisfies both.

**ConversationRepository**:
The conversations slice's port for durable Conversation storage — create, read, list, delete. Message writes (runs' MessageStore), renames (titling's ConversationRenamer) and Feedback (feedback's FeedbackStore) are other slices' ports on the same adapter. Adapter: SQLite (bun:sqlite).

**RunStreamStore**:
The runs slice's port for buffering and fanning out the live event stream of a Run, enabling mid-stream resume. Adapter: Redis Streams.
