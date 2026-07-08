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

**Provenance**:
Where a Model executes: `local` (e.g. Ollama) or `remote` (e.g. Anthropic, OpenAI). A property of the Model, invisible to the domain logic.
_Avoid_: Provider type, origin

**ModelGateway**:
The port through which the domain starts a Run against any Model, regardless of Provenance. Adapters wrap @crisp/ai provider adapters (in-house, ADR-0003).

**ConversationRepository**:
The port for durable Conversation storage. Adapter: SQLite (bun:sqlite).

**RunStreamStore**:
The port for buffering and fanning out the live event stream of a Run, enabling mid-stream resume. Adapter: Redis Streams.
