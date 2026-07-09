# The product explains itself: Tour Mode and a persisted Tour Context

The empty state's suggestion chips become the **Tour Questions** — what Crisp can do, how it is architected, what monitoring exists, how streaming survives a refresh — and the product answers them itself. The zero-key Demo model streams canned answers from a script (`apps/server/src/infra/tour-script.ts`, one entry per question, with matching canned titles for the auto-titling run). Real models — remote or the user's own Ollama — answer from the **Tour Context**: a ~700-word briefing injected as a system Message.

The mechanics, chosen deliberately:

- **The Tour Context is a persisted, first-class Message.** `messageRoleSchema` gains `system` (aligned with AG-UI's `SystemMessage`); the wire codec reads a `leadingSystemMessage` the same way it reads the trailing user Message; both conversation-creating routes (`/api/chat` and `/byo-runs`) persist it once, at creation. Stored history therefore _is_ what every Run of the conversation saw — a reload can't silently drop the model's context.
- **The client mints it.** The BYO Ollama path runs in the page before anything reaches the server, so the browser needs the prompt at run time regardless; minting client-side gives one injection point for both paths, and the id persisted server-side is the id already in the client transcript.
- **Tour Mode is a composer toggle, on by default,** persisted in localStorage like every other client preference. It affects new Conversations only; existing ones keep whatever they were created with. The transcript hides system Messages from the message flow but discloses the context behind a "Tour context attached" note that expands to the full text — what the model was told is one click away.

Trade-off accepted deliberately: with the mode on, every conversation on a user-keyed model re-sends the briefing to a stateless provider — roughly a thousand prompt tokens per Run on the visitor's own key — and the model knows about Crisp even in unrelated chats. The toggle is the mitigation; default-on is the point (the tour must be discoverable with zero setup).

Rejected: per-run, non-persisted injection (the stored history would no longer match what runs actually saw, and a reload would silently drop the context mid-conversation); server-minted injection driven by a mode cookie (the BYO path needs the prompt in-page anyway, leaving two injection points that must agree, and the cookie becomes load-bearing wire state); explaining the work in the README alone (the person evaluating a chat product should be able to ask the chat product).

The canned script and the Tour Context state the same facts in two genres — showcase prose and a compact briefing. They are hand-written and cross-referenced; when the product changes, both change.

Status: accepted
