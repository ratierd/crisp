# Crisp — UI copy spec

Terms follow CONTEXT.md: Conversation, Message, Run, Model, Provenance.
Voice: calm, specific, no exclamation marks, no apologies. Metadata is lowercase; titles are sentence case.

## Empty state (first run)

- Heading: `Start a conversation.`
- Body: `The Demo model answers without any API keys, so your first message always works. Switch models from the composer whenever you're ready.`
- Suggestion chips (send on click):
  - `Explain OKLCH like I'm a designer`
  - `Draft a launch post for a small CLI tool`
  - `Why does serif type read better in long form?`

## Error card (one pattern, per-kind variation)

Card = glyph in hairline circle · title (semibold) · kind label (mono, footnote) · body · `Retry` button.
`{provider}` = human name of the model's provider (Ollama, Anthropic, OpenAI, "the demo provider").

| kind                 | glyph | title                 | body                                                                                             |
| -------------------- | ----- | --------------------- | ------------------------------------------------------------------------------------------------ |
| provider_unavailable | ⊘     | Provider unreachable  | Crisp couldn't reach {provider}. Check that it's running and reachable, then retry.              |
| auth_failed          | ✕     | Authentication failed | {provider} rejected the request — the API key looks missing or invalid. Fix the key, then retry. |
| rate_limited         | ◔     | Rate limited          | {provider} asked us to slow down. Give it a few seconds, then retry.                             |
| aborted              | ▪     | Run stopped           | The run was stopped before the first token arrived. Nothing was written.                         |
| unknown              | ?     | Something went wrong  | An unexpected error ended this run. Retrying usually works.                                      |

Note: `aborted` renders as a card only when zero tokens arrived. If a partial Message
exists, keep the prose and show the stopped footnote instead (below).

## Disabled models (picker hints)

Shown under the model name, disabled row at 55% opacity, not clickable.

- Ollama down: `Ollama isn't running — start it, then reopen this menu.`
- Missing key: `ANTHROPIC_API_KEY is missing from the environment.` (same pattern per provider key)

## Run lifecycle strings

- Waiting for first token (pulsing block + mono footnote): `{Model} · waiting for first token`
- Live indicator (top bar, pulsing dot): `run live`
- Reconnect pill after refresh: `reconnecting to run…`
- Stopped footnote under partial prose: `▪ stopped early` + link-button `regenerate`
- Latency badge (mono footnote under completed Message): `{t.t}s to first token · {n} tok/s · {Model}`

## Composer

- Placeholder: `Write a message…` / while reattaching: `Reconnecting to run…`
- Stop button: `Stop` with `esc` hint
- Shortcut hints row (mono footnote): `enter · send   shift+enter · newline   esc · stop   ⌘k · new conversation`

## Provenance badges

Pill, mono, lowercase: `local` / `remote`. Neutral color — provenance is information, not status.
