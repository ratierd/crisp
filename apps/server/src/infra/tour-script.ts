/**
 * The Demo model's side of the Tour (ADR-0009): canned answers to the Tour
 * Questions the empty state suggests, written to explain what was built and
 * to exercise the markdown renderer while doing it. Real models answer the
 * same questions from the Tour Context the client injects; the facts here
 * and there must agree — update both when the product changes.
 */

export interface TourEntry {
  /** Matched against the last user message; first match wins. */
  match: RegExp;
  /** The canned Conversation title the demo titling run returns. */
  title: string;
  answer: string;
}

const FEATURES: TourEntry = {
  match: /feature|around|what can|show me/i,
  title: 'Crisp feature tour',
  answer: `Welcome to **Crisp** — a multi-AI chat client. I'm the zero-key Demo model, so this whole tour works before you configure anything. Here's what's on board, rendered in the markdown you're evaluating:

## Models

- **Model picker with health gating** — every model is listed; the unusable ones stay visible but disabled, with a hint explaining why (missing key).
- **BYOK** — paste your Anthropic / OpenAI / OpenRouter key (or mint one via the one-click **Connect with OpenRouter** OAuth flow) and the disabled models light up. Keys live in *your browser only*, travel per-request, and are never persisted or logged server-side.
- **BYO Ollama** — your local models run straight from this page against your own daemon; the picker shows the one-line \`OLLAMA_ORIGINS\` command that opts it in.

## The chat itself

| Feature | Try it |
| --- | --- |
| Streaming with mid-stream resume | refresh while I'm answering |
| Stop / regenerate | Esc, or the buttons under an answer |
| Typed error cards with retry | send \`error:rate_limited\` |
| Feedback | 👍/👎 under any answer |
| Conversation history + auto-titles | check the sidebar after this exchange |
| Latency badges | TTFT · tok/s under each finished answer |

## Polish

Dark/light themes from one OKLCH token set (\`light-dark()\`), keyboard shortcuts (Enter / Shift+Enter / Esc / ⌘K), Shiki-highlighted code blocks, responsive down to mobile:

\`\`\`ts
const shortcuts = { send: 'Enter', newline: 'Shift+Enter', stop: 'Esc', search: '⌘K' };
\`\`\`

Ask me **how Crisp is architected**, **what monitoring is in place**, or **how streaming works** — or switch to a real model from the composer: with Tour mode on, it knows all of this too.`,
};

const ARCHITECTURE: TourEntry = {
  match: /architect|structur|organi[sz]|slice|hexagon|codebase|code quality/i,
  title: 'How Crisp is built',
  answer: `Crisp is a **Bun + Nx monorepo**: a Vue 3 SPA (\`apps/web\`), a Hono API (\`apps/server\`), and libs organized as **feature slices** — one lib per user-visible capability, each owning its zod wire contracts, the ports it consumes, and its behavior, with no IO of its own:

\`\`\`
libs/
  ai/        in-house AG-UI client: provider adapters, SSE, useChat
  features/
    conversations/  Conversation + Message schemas, ConversationRepository port
    runs/           RunService, ModelGateway / MessageStore / RunStreamStore ports
    titling/        auto-titling, TitleModel + ConversationRenamer ports
    feedback/       FeedbackService, FeedbackStore + FeedbackSink ports
    models/         Model registry, KeyConfig port
\`\`\`

Two rules, both **lint-enforced**:

1. Cross-slice, a feature is reachable through its \`/contracts\` entry only — full interfaces are for the composition root in \`apps/server\`.
2. Every port is **consumer-owned**: declared by the slice that calls it, sized to exactly what it uses. Structural typing then lets one adapter serve many slices — the SQLite repository satisfies four slices' ports, the AI gateway two.

Other load-bearing decisions (each has an ADR in \`docs/adr/\`):

- The AI client is **in-house** — no Vercel AI SDK, no chat UI kit. Provider wire formats are contained behind \`ModelGateway\`.
- **AG-UI events cross the hexagon untranslated**: the slices only inspect event discriminants, so the riskiest code path (stream handling) has no translation layer to get wrong.
- Observability is a **decorator** on the gateway — remove the LangSmith key and the app composes exactly as if the feature never existed.

> The browser and the server validate against the *same* zod schemas, so the API can't silently drift.`,
};

const MONITORING: TourEntry = {
  match: /monitor|observab|langsmith|trace|telemetr|analytics|cost/i,
  title: 'Monitoring & observability',
  answer: `Crisp ships with real observability, not a screenshot of one:

## LangSmith (set \`LANGSMITH_API_KEY\`)

- **Every Run becomes a trace** — remote, local, demo, stopped, or failed — with token usage and cost. The trace id *is* the Run's id.
- **Conversations group as Threads**, so a whole exchange reads as one story.
- **Browser-executed Runs are mirrored too**: your own Ollama runs in this page, then the finished run is reported server-side and recorded post-hoc.
- **Feedback lands on the exact trace**: the 👍/👎 under each answer (with an optional "what went wrong" note) attaches to that Run in LangSmith.

Tracing is a *decorator* on the model gateway — without the key, the app composes exactly as it did before the feature existed.

## In the product

- **Latency badges** under every finished answer: time-to-first-token · tokens/sec, measured per Run and persisted with the message.
- **\`/api/health\`** is honest: it actually pings Redis and SQLite and degrades to 503 when one is down.

## Abuse controls on the hosted instance

Per-IP rate limits by route class, a request body cap, secure headers + CSP protecting the browser-held BYOK keys, and conversations scoped to an anonymous cookie.

Try the feedback flow on this very answer — the thumbs are live.`,
};

const STREAMING: TourEntry = {
  match: /stream|refresh|resume|reconnect|interrupt|realtime|real-time/i,
  title: 'Streaming and resume',
  answer: `Streaming is the part most chat demos fake — so Crisp's is built to survive you. **Refresh the page right now, while this answer is still streaming.** I'll wait… see? It reattached and kept writing.

Here's why that works:

\`\`\`
client ──POST /api/chat──▶ server
                            │ starts the Run *detached*
                            │ tees every AG-UI event ──▶ Redis Stream
   ◀──SSE (a replay of the stream, not the run)──┘
\`\`\`

1. The client sends the conversation as an **AG-UI payload**; events come back over SSE and the transcript assembles token by token.
2. The server runs generation **detached from the HTTP request**, teeing every event into a Redis Stream. The response you're reading is a *replay* of that stream.
3. Kill the connection and the Run doesn't care — it finishes anyway, and the exchange persists to SQLite. A reloading client replays the buffered events, then tails the rest live.

The controls ride the same machinery:

- **Stop** (Esc) aborts the Run and keeps the partial answer — persisted, marked as stopped early.
- **Regenerate** re-sends history ending at your last message; the superseded answer is replaced, not duplicated.
- **Errors are typed** — \`provider_unavailable\`, \`auth_failed\`, \`rate_limited\`, \`aborted\` — each with its own card and a retry. Send \`error:rate_limited\` to see one.

One honest limit: runs against *your own Ollama* execute in this page, so they can't resume after a reload — the finished part is persisted instead.`,
};

const OKLCH: TourEntry = {
  match: /oklch/i,
  title: 'OKLCH for designers',
  answer: `OKLCH is a way of describing color by how it *looks*, not by how a screen mixes it.

- **L — lightness** (0–100%): how bright the color appears. Two colors with the same L genuinely look equally bright, which RGB can't promise.
- **C — chroma**: how colorful it is, from gray (0) upward. Unlike HSL "saturation", chroma is absolute — you can compare it across hues.
- **H — hue**: the angle on the color wheel, 0–360.

The designer's win: build a palette by *fixing* two channels and sweeping the third.

\`\`\`css
--accent:        oklch(55% 0.19 258); /* brand blue */
--accent-hover:  oklch(50% 0.19 258); /* same color, just darker */
--accent-subtle: oklch(93.5% 0.04 258); /* same hue, washed out */
\`\`\`

Change \`258\` to \`60\` and the whole system becomes orange — with the same perceived contrast. That's why design tokens love it (and why Crisp's dark/light themes are one OKLCH token set).`,
};

/** Ordered — first match wins; FEATURES is also the fallback. */
const ENTRIES: TourEntry[] = [OKLCH, ARCHITECTURE, MONITORING, STREAMING, FEATURES];

export const pickTourEntry = (lastUserText: string): TourEntry =>
  ENTRIES.find((entry) => entry.match.test(lastUserText)) ?? FEATURES;
