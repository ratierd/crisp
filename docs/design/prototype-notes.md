# Crisp prototype — implementer notes

Source: `docs/design/prototype.html` (claude.ai/design export, "Crisp Prototype.dc.html", 50,615 bytes, complete).
Companion: `docs/design/tokens.css` (already in repo — all `var(--*)` references below resolve there unless noted).

The prototype is a single React-ish component with all styles inline. Everything below is transcribed
from it, normalized to the tokens.css vocabulary. Where the prototype hard-codes a value that exists
as a token, the token is named; where a value has no token, the raw value is given.

Token deltas to know about before building:

- The prototype defines `--font-head` (headings) separately from `--font-prose`; both are
  `'Source Serif 4', Georgia, serif`. tokens.css only has `--font-prose` — either add `--font-head`
  or use `--font-prose` for headings.
- The prototype uses a code-punctuation color `--code-p: light-dark(oklch(40% 0.015 262), oklch(66% 0.012 262))`
  which tokens.css lacks (tokens.css has `--code-str` instead, unused by the demo highlighter).
- The prototype's popover shadow `0 8px 28px rgba(0,0,0,0.14)` == tokens.css `--shadow-pop`.
- Demo-only: a dashed "SPEC CONTROLS" toolbar at the very top (cycle type, arm error, simulate
  refresh, first-run view, restore demo). It is gated behind a `specControls` prop. Do NOT build it
  into the product UI; its only value is documenting which states exist.
- Designer-exposed props: `accentHue` (blue 258 default; orange 60 / pink 350 alternates, chroma
  0.16 light / 0.13 dark for the alternates), `contentWidth` (`62ch | 70ch | 76ch`, default `70ch`
  → `--measure`).

---

## 1. Overall layout

- Root: `height:100dvh; display:flex; flex-direction:column; background:var(--bg);
color:var(--text); font-family:var(--font-ui); overflow:hidden`. Theme is applied by setting
  `color-scheme` on this root (see §7).
- Main row (below optional toolbar): `flex:1; display:flex; min-height:0; position:relative`
  (the `position:relative` anchors the narrow-mode sidebar overlay + scrim).
- Two children: **Sidebar** (conditionally rendered) and **Main column**
  (`flex:1; min-width:0; display:flex; flex-direction:column`).
- **Responsive breakpoint:** a ResizeObserver on the root; `narrow = rootWidth < 780px`. Entering
  narrow mode force-closes the sidebar. (In Vue: a container query or window resize listener; the
  threshold is 780px on the app container, not the viewport.)
- **Sidebar collapse:** the sidebar is removed from the DOM entirely when closed (no width
  animation in the prototype). Two modes:
  - Wide: in-flow column, `width:264px; flex:none; display:flex; flex-direction:column;
background:var(--bg-inset); border-right:1px solid var(--border-faint)`.
  - Narrow (overlay): `position:absolute; top:0; bottom:0; left:0; z-index:30; width:272px;
display:flex; flex-direction:column; background:var(--bg-inset);
border-right:1px solid var(--border); box-shadow:0 0 44px rgba(0,0,0,0.2)`, plus a scrim
    behind it: `position:absolute; inset:0; background:rgba(0,0,0,0.28); z-index:25`, click closes.
  - Picking a conversation in narrow mode also closes the sidebar.
- **Top bar** (inside main column): `flex:none; display:flex; align-items:center; gap:8px;
padding:9px 16px`. Contents, left to right:
  - Sidebar toggle button `▤`: `background:none; border:none; color:var(--text-3); font-size:14px;
padding:4px 7px; border-radius:6px`; hover `color:var(--text); background:var(--bg-inset)`.
  - Only when the sidebar is closed: wordmark `Crisp` (`font-family:var(--font-head);
font-weight:600; font-size:15px; letter-spacing:-0.01em`) followed by a `/` separator
    (`color:var(--border); font-size:12px`).
  - Conversation title: `font-size:13px; color:var(--text-2); white-space:nowrap; overflow:hidden;
text-overflow:ellipsis`. Falls back to "New conversation".
  - `flex:1` spacer.
  - While a run is live, a **"run live" indicator**: `display:flex; align-items:center; gap:6px;
font-family:var(--font-meta); font-size:10px; color:var(--text-3)` containing a pulsing dot
    `width:6px; height:6px; border-radius:50%; background:var(--accent);
animation:crisp-pulse 1.2s ease-in-out infinite` and the text `run live`.
  - Theme toggle (see §7).

## 2. Sidebar

- **Header:** `display:flex; align-items:center; justify-content:space-between;
padding:14px 14px 8px 16px`. Wordmark `Crisp`: `font-family:var(--font-head); font-weight:600;
font-size:17px; letter-spacing:-0.01em`. Collapse button `«`: `background:none; border:none;
color:var(--text-3); font-size:13px; padding:4px 7px; border-radius:6px`; hover
  `color:var(--text); background:var(--bg)` (note: hover bg is `--bg`, lighter than the inset
  sidebar, the inverse of buttons that sit on `--bg`).
- **New conversation button:** `display:flex; align-items:center; gap:8px; margin:4px 12px 10px;
padding:8px 11px; border:1px solid var(--border); border-radius:8px; background:var(--surface);
color:var(--text); font-family:var(--font-ui); font-size:13px; text-align:left`; hover
  `border-color:var(--accent)`. Children: `+` glyph (`color:var(--accent); font-size:15px;
line-height:1`), label "New conversation", and a `⌘K` hint pushed right
  (`margin-left:auto; font-family:var(--font-meta); font-size:9.5px; color:var(--text-3)`).
- **List container:** `flex:1; overflow-y:auto; padding:2px 10px 14px; display:flex;
flex-direction:column; gap:2px`.
- **Conversation item:** `padding:8px 10px; border-radius:8px; cursor:pointer`.
  - Active: `background:var(--bg); border:1px solid var(--border-faint)`.
  - Inactive: `background:transparent; border:1px solid transparent` (transparent border keeps
    geometry identical between states — replicate this).
  - Hover (both states): `background:var(--bg)`.
  - Row 1: `display:flex; align-items:center; gap:7px` — active items get a dot
    `width:5px; height:5px; border-radius:50%; background:var(--accent); flex:none`, then the
    title `font-size:13px; line-height:1.35; white-space:nowrap; overflow:hidden;
text-overflow:ellipsis`.
  - Row 2 (relative timestamp, e.g. "38m ago" / "3h ago" / "just now"):
    `font-family:var(--font-meta); font-size:9.5px; color:var(--text-3); margin-top:3px`.
- **Empty list:** `No conversations yet.` — `padding:10px 6px; font-size:12px; color:var(--text-3)`.
- Titles are derived from the first user message, truncated at 44 chars + `…`.

## 3. Transcript

- **Scroll region:** `flex:1; overflow-y:auto; scrollbar-gutter:stable both-edges; min-height:0`
  (matches `.scroll-region` in tokens.css).
- **Reading column:** `max-width:var(--measure); margin:0 auto; padding:10px 26px 30px`.
- **User message** — inset card, sans-serif, deliberately quieter than assistant prose:
  `margin:30px 0 24px; padding:12px 16px; background:var(--bg-inset); border-radius:10px
(--radius-m); font-family:var(--font-ui); font-size:14.5px; line-height:1.55; color:var(--text);
white-space:pre-wrap; max-width:56ch`. Left-aligned; no avatar, no right-alignment, no bubble tail.
- **Assistant message** — plain prose directly on the page background (no card/bubble). Wrapper:
  `font-family:var(--font-prose); font-size:16.5px; line-height:1.72; color:var(--text);
margin:0 0 36px`. Block styles inside:
  - Paragraph: `margin:0 0 1.05em`. Inline `<strong>`: `font-weight:600`. Inline `<code>`:
    `font-family:var(--font-meta); font-size:0.82em; background:var(--code-bg);
border:1px solid var(--border-faint); border-radius:4px; padding:1px 5px`.
  - `<h2>`: `font-family:var(--font-head); font-size:1.22em; font-weight:600;
letter-spacing:-0.01em; margin:1.6em 0 0.65em`.
  - List item (hand-rolled, not `<ul>`): `display:flex; gap:12px; margin:0 0 0.55em;
padding-left:2px`; marker is an en-dash `–` in `color:var(--text-3); flex:none`; content in a
    `flex:1` div.
  - Blockquote: `margin:1.2em 0; padding:2px 0 2px 18px; border-left:2px solid var(--accent);
color:var(--text-2); font-style:italic`.
  - Code block and table: see §6.
- **Latency badge (meta line)** — appears under a _finished_ assistant message, inside the prose
  wrapper: `margin-top:10px; font-family:var(--font-meta); font-size:10px; color:var(--text-3);
letter-spacing:0.02em`. Text format: `0.8s to first token · 42 tok/s · Demo`
  (ttft seconds with 1 decimal, tokens/sec integer, model display name, `·` separators).
- **Stopped footnote** (see §5) sits in the same slot when a message was stopped early.
- **Autoscroll rule:** during streaming, only stick to bottom if the user is within 160px of the
  bottom (`scrollHeight - scrollTop - clientHeight < 160`); jump to bottom on send/resume.

## 4. Composer

- **Outer:** `flex:none; padding:0 26px 14px` (main column footer). Inner wrapper:
  `max-width:var(--measure); margin:0 auto; position:relative` — this `relative` anchors the
  model-picker popover.
- **Box:** `border:1px solid var(--border); border-radius:12px (--radius-l);
background:var(--surface); padding:10px 12px 8px; box-shadow:0 1px 3px rgba(0,0,0,0.04)`.
- **Textarea:** `rows="1"; width:100%; border:none; outline:none; background:transparent;
resize:none; font-family:var(--font-ui); font-size:14.5px; line-height:1.55; color:var(--text);
field-sizing:content; min-height:23px; max-height:180px; padding:2px 2px 6px; display:block`.
  Auto-grows via CSS `field-sizing:content` (no JS). Placeholder `Write a message…`
  (color `var(--text-3)` via `textarea::placeholder`), switching to `Reconnecting to run…` while
  reconnecting. Focused on mount and after "new conversation".
  Keys: Enter sends (Shift+Enter newline); Escape (global) stops the run / closes the picker;
  Cmd/Ctrl+K (global) starts a new conversation.
- **Bottom row:** `display:flex; align-items:center; gap:10px`.
- **Model picker trigger** (left): `display:flex; align-items:center; gap:7px; background:none;
border:none; padding:4px 7px; border-radius:6px; color:var(--text-2);
font-family:var(--font-ui); font-size:12.5px`; hover `background:var(--bg-inset)`. Children:
  accent status dot (`width:6px; height:6px; border-radius:50%; background:var(--accent)`),
  model name, **provenance badge**, and a `▾` chevron (`font-size:8.5px; color:var(--text-3)`).
- **Provenance badge** (used both in trigger and popover rows): text `local` or `remote`,
  `font-family:var(--font-meta); font-size:9px; letter-spacing:0.06em; padding:2px 7px;
border-radius:999px; border:1px solid var(--border); color:var(--text-3)`.
- **Send button** (shown when not running): 34×34 circle, `border-radius:999px; border:none;
font-size:16px; display:grid; place-items:center`, glyph `↑`.
  - Enabled (has text, not running/reconnecting): `background:var(--accent);
color:var(--accent-ink); cursor:pointer`.
  - Disabled: `background:var(--bg-inset); color:var(--text-3); cursor:default`.
- **Stop button** (replaces Send while running): `display:flex; align-items:center; gap:8px;
border:1px solid var(--border); background:var(--bg-inset); border-radius:8px; padding:6px 13px;
font-family:var(--font-ui); font-size:12.5px; color:var(--text)`; hover
  `border-color:var(--accent)`. Children: stop square `width:9px; height:9px;
background:var(--text); border-radius:2px`, label `Stop`, hint `esc`
  (`font-family:var(--font-meta); font-size:9px; color:var(--text-3)`).
- **Model picker: a popover, not a `<select>`.** Positioned above the composer:
  `position:absolute; bottom:calc(100% + 8px); left:0; width:min(360px, 100%);
background:var(--surface); border:1px solid var(--border); border-radius:10px;
box-shadow:var(--shadow-pop); padding:6px; z-index:20`.
  - Section header `MODEL`: `padding:6px 10px 4px; font-family:var(--font-meta); font-size:9.5px;
letter-spacing:0.08em; color:var(--text-3)`.
  - Row: `padding:9px 10px; border-radius:7px`; hover `background:var(--bg-inset)`. Row line 1
    (`display:flex; align-items:center; gap:8px`): name (`font-family:var(--font-ui);
font-size:13.5px; font-weight:500; color:var(--text)`), provenance badge, and for the selected
    model a check `✓` pushed right (`margin-left:auto; color:var(--accent); font-size:12px`).
  - **Disabled model:** `opacity:0.55; cursor:default`, click ignored, plus a hint line under the
    name row: `margin-top:3px; font-family:var(--font-ui); font-size:11.5px; line-height:1.4;
color:var(--text-3)`. Demo hints: "Ollama isn't running — start it, then reopen this menu." and
    "ANTHROPIC_API_KEY is missing from the environment." Disabled models stay visible and listed.
  - Dismissal: click outside (root click handler), Escape, or picking an available model.
    Clicks inside the popover call stopPropagation.
- **Shortcut hints row** (below the composer box): `display:flex; gap:16px; margin:8px 4px 0;
font-family:var(--font-meta); font-size:9.5px; color:var(--text-3); flex-wrap:wrap` with four
  spans: `enter · send`, `shift+enter · newline`, `esc · stop`, `⌘k · new conversation`.

## 5. Designed states

- **Empty state** (no conversation or zero messages), rendered inside the reading column:
  - Wrapper: `padding-top:10vh`.
  - `<h1>` "Start a conversation." — `font-family:var(--font-head);
font-size:clamp(26px, 4vw, 34px) (--fs-h1); font-weight:600; letter-spacing:-0.015em;
margin:0 0 12px; color:var(--text)`.
  - Lede paragraph — `font-family:var(--font-prose); font-size:16.5px; line-height:1.65;
color:var(--text-2); margin:0 0 28px; max-width:46ch`. Copy: "The Demo model answers without
    any API keys, so your first message always works. Switch models from the composer whenever
    you're ready."
  - **Suggestion chips:** container `display:flex; flex-wrap:wrap; gap:8px`; chip
    `border:1px solid var(--border); background:var(--surface); border-radius:999px;
padding:7px 15px; font-family:var(--font-ui); font-size:13px; color:var(--text-2)`; hover
    `border-color:var(--accent); color:var(--accent)`. Clicking a chip sends its label as the
    message. Demo chips: "Explain OKLCH like I'm a designer", "Draft a launch post for a small CLI
    tool", "Why does serif type read better in long form?".
- **Waiting for first token** (run started, 0 tokens): at the top of the assistant slot,
  `display:flex; align-items:center; gap:10px; margin:4px 0 8px`: a pulsing accent block
  `display:inline-block; width:9px; height:18px; background:var(--accent); border-radius:2px;
animation:crisp-pulse 1.1s ease-in-out infinite`, plus a label `font-family:var(--font-meta);
font-size:10.5px; color:var(--text-3)` reading `{Model name} · waiting for first token`.
  (Prototype simulates 650–1200ms of this phase.)
- **Streaming indicator (caret):** once tokens flow, the waiting row disappears and an inline
  caret trails the last rendered character: `display:inline-block; width:8px; height:16px;
background:var(--accent); border-radius:1.5px; margin-left:2px; vertical-align:-2px;
animation:crisp-caret 1s steps(1) infinite`. The design brief embedded in the demo copy says
  the caret is intentionally _the only animation on the page_ while running (plus the small pulse
  dots). Also: top bar shows "run live" (§1) while streaming.
- **Error card** (replaces the assistant message in the transcript):
  - Card: `margin:8px 0 32px; border:1px solid var(--border); border-radius:10px;
background:var(--surface); padding:14px 16px; display:flex; gap:13px;
align-items:flex-start; max-width:52ch; font-family:var(--font-ui)`.
  - Glyph circle: `flex:none; width:26px; height:26px; border:1px solid var(--border);
border-radius:50%; display:grid; place-items:center; font-size:12px; color:var(--text-2)`.
  - Title row: `display:flex; align-items:baseline; gap:10px; flex-wrap:wrap` — title
    (`font-weight:600; font-size:13.5px`) + machine kind tag (`font-family:var(--font-meta);
font-size:9.5px; color:var(--text-3)`, e.g. `auth_failed`).
  - Body: `margin:4px 0 11px; font-size:13px; line-height:1.5; color:var(--text-2)`.
  - Retry button: `background:none; border:1px solid var(--accent); color:var(--accent);
border-radius:6px; padding:5px 13px; font-family:var(--font-ui); font-size:12.5px;
font-weight:500`; hover `background:var(--accent-subtle)`. Retry removes the error card and
    starts a fresh run.
  - Error catalog (glyph / title / body template — `${p}` is the provider display name, e.g.
    "Ollama", "Anthropic", "the demo provider"):
    - `⊘` **Provider unreachable** — "Crisp couldn't reach ${p}. Check that it's running and reachable, then retry."
    - `✕` **Authentication failed** — "${p} rejected the request — the API key looks missing or invalid. Fix the key, then retry."
    - `◔` **Rate limited** — "${p} asked us to slow down. Give it a few seconds, then retry."
    - `▪` **Run stopped** (kind `aborted`) — "The run was stopped before the first token arrived. Nothing was written." (This is what Stop produces when zero tokens have arrived.)
    - `?` **Something went wrong** — "An unexpected error ended this run. Retrying usually works."
- **Reconnecting pill** (page reloaded mid-run; shown ~1.1s before the stream reattaches, appended
  after the messages in the reading column): outer `display:flex; justify-content:center;
margin:16px 0`; pill `display:inline-flex; align-items:center; gap:8px;
font-family:var(--font-meta); font-size:10.5px; color:var(--text-2);
border:1px solid var(--border); border-radius:999px; padding:5px 13px;
background:var(--surface)` containing a pulsing dot (`width:6px; height:6px;
border-radius:50%; background:var(--accent); animation:crisp-pulse 1.1s ease-in-out infinite`)
  and text `reconnecting to run…`. While reconnecting, sending is disabled and the composer
  placeholder reads `Reconnecting to run…`. On reattach, replayed tokens resume with **no** waiting
  phase and the transcript scrolls to bottom.
- **Stopped footnote** (message stopped after some tokens arrived; sits where the latency badge
  would): `display:flex; align-items:center; gap:12px; margin-top:10px;
font-family:var(--font-meta); font-size:10px; color:var(--text-3)` — `▪ stopped early` plus a
  `regenerate` link-button (`background:none; border:none; padding:0; font-family:var(--font-meta);
font-size:10px; color:var(--accent)`; hover `text-decoration:underline`). Regenerate clears and
  re-streams the same message in place. A stopped message shows no latency badge.

## 6. CSS worth copying verbatim

Keyframes (the caret uses `steps(1)` for a hard terminal-style blink, not a fade):

```css
@keyframes crisp-caret {
  0%,
  55% {
    opacity: 1;
  }
  56%,
  100% {
    opacity: 0;
  }
}
@keyframes crisp-pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}
```

Base rules from the prototype's stylesheet:

```css
* {
  box-sizing: border-box;
}
html,
body {
  margin: 0;
  padding: 0;
  height: 100%;
}
a {
  color: var(--accent);
}
a:hover {
  color: var(--accent);
  text-decoration: underline;
}
::selection {
  background: var(--accent-subtle);
}
button {
  font: inherit;
}
textarea::placeholder {
  color: var(--text-3);
}
```

Popover (as a class, transcribed from the inline styles):

```css
.model-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  width: min(360px, 100%);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.14); /* == var(--shadow-pop) */
  padding: 6px;
  z-index: 20;
}
```

Code block (transcribed):

```css
.code-block {
  margin: 1.2em 0;
  border: 1px solid var(--border-faint);
  border-radius: 8px;
  background: var(--code-bg);
  overflow: hidden;
}
.code-block-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 13px;
  border-bottom: 1px solid var(--border-faint);
}
.code-block-lang {
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-3);
  letter-spacing: 0.05em;
}
.code-block-copy {
  background: none;
  border: none;
  padding: 2px 4px;
  font-family: var(--font-meta);
  font-size: 10px;
  color: var(--text-3);
  cursor: pointer;
}
.code-block-copy:hover {
  color: var(--accent);
}
.code-block pre {
  margin: 0;
  padding: 13px 15px;
  overflow-x: auto;
  font-family: var(--font-meta);
  font-size: 12.5px;
  line-height: 1.65;
}
.code-block pre > div {
  min-height: 1.65em;
} /* per-line rows; keeps blank lines tall */
```

Copy button label toggles `copy` → `copied ✓` and reverts after **1400ms**. Syntax colors map
tokens to `var(--code-kw)` (keywords/property names), `var(--code-fn)` (function names/selectors),
`var(--code-num)` (numbers/values), `var(--code-com)` (comments), `var(--code-p)` (punctuation —
add this token), default `var(--text)`.

Inline code (inside prose):

```css
.prose code {
  font-family: var(--font-meta);
  font-size: 0.82em;
  background: var(--code-bg);
  border: 1px solid var(--border-faint);
  border-radius: 4px;
  padding: 1px 5px;
}
```

Table (transcribed):

```css
.prose table {
  border-collapse: collapse;
  margin: 1.2em 0;
  width: 100%;
}
.prose th {
  text-align: left;
  padding: 7px 12px;
  border-bottom: 1px solid var(--border);
  font-family: var(--font-ui);
  font-weight: 600;
  font-size: 12px;
  color: var(--text-2);
  letter-spacing: 0.03em;
}
.prose td {
  padding: 7px 12px;
  border-bottom: 1px solid var(--border-faint);
  font-family: var(--font-meta);
  font-size: 12px;
  color: var(--text);
}
```

## 7. Theme toggle

- A single icon button at the far right of the top bar: glyph `◐` in light mode, `◑` in dark.
  Styles: `background:none; border:none; color:var(--text-3); font-size:15px; padding:4px 7px;
border-radius:6px`; hover `color:var(--text); background:var(--bg-inset)`.
- Mechanism: the prototype sets `style.colorScheme = 'light' | 'dark'` on the app root, and every
  color token is `light-dark(...)`, so the whole palette flips with no per-theme CSS. In the Vue
  app, per tokens.css, set `data-theme="light|dark"` on `:root` instead (tokens.css already maps
  `[data-theme]` → `color-scheme`); omit the attribute to follow the OS.
- Theme choice persists (prototype stores it in localStorage alongside conversations/model).
- No transition/animation on theme switch.

## Behavioral notes embedded in the prototype (for parity)

- Enter = send; Shift+Enter = newline; Escape = stop run + close picker (global);
  Cmd/Ctrl+K = new conversation (global).
- Send is a no-op while running or reconnecting, or when the trimmed text is empty.
- Stop semantics: if 0 tokens had arrived, the pending message becomes an `aborted` error card;
  if tokens had arrived, the message is kept and gets the "stopped early" footnote + regenerate.
- Conversation title = first user message truncated to 44 chars + `…`; sidebar timestamps are
  relative ("just now", "Nm ago", "Nh ago", "Nd ago").
- Streaming autoscroll only when within 160px of the bottom.
- Textarea autofocus on load and on new conversation.
