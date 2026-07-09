import type { RunEvent, StartRunOptions } from '@crisp/domain';

const SHOWCASE = `Here's a quick tour of what Crisp renders — streamed straight from the zero-key **Demo** model.

## Markdown, properly

Prose is the hero here: paragraphs, *emphasis*, **strong text**, and \`inline code\` all flow as regular typography. Lists too:

- Streaming arrives token by token over AG-UI events
- Every Run is buffered, so a page refresh reattaches mid-generation
- Provenance (\`local\` vs \`remote\`) is a property of the Model, not the code

> Blockquotes get a quiet accent border — information, not decoration.

## Code blocks

\`\`\`ts
type Provenance = 'local' | 'remote';

interface Model {
  id: string;
  displayName: string;
  provenance: Provenance; // invisible to the domain logic
}

const pick = (models: Model[]) =>
  models.find((m) => m.provenance === 'local') ?? models[0];
\`\`\`

## Tables

| Piece | Role |
| --- | --- |
| ModelGateway | starts a Run against any Model |
| RunStreamStore | buffers live events for resume |
| ConversationRepository | durable history |

Try switching models from the composer — or ask me anything else and I'll keep improvising.`;

const OKLCH_ANSWER = `OKLCH is a way of describing color by how it *looks*, not by how a screen mixes it.

- **L — lightness** (0–100%): how bright the color appears. Two colors with the same L genuinely look equally bright, which RGB can't promise.
- **C — chroma**: how colorful it is, from gray (0) upward. Unlike HSL "saturation", chroma is absolute — you can compare it across hues.
- **H — hue**: the angle on the color wheel, 0–360.

The designer's win: build a palette by *fixing* two channels and sweeping the third.

\`\`\`css
--accent:        oklch(55% 0.19 258); /* brand blue */
--accent-hover:  oklch(50% 0.19 258); /* same color, just darker */
--accent-subtle: oklch(93.5% 0.04 258); /* same hue, washed out */
\`\`\`

Change \`258\` to \`60\` and the whole system becomes orange — with the same perceived contrast. That's why design tokens love it.`;

const ERROR_TRIGGER = /error:(provider_unavailable|auth_failed|rate_limited|unknown)/;

const pickResponse = (lastUserText: string, systemText: string): string => {
  if (/short title/i.test(systemText)) {
    return /oklch/i.test(lastUserText) ? 'OKLCH for designers' : 'A quick markdown tour';
  }
  if (/oklch/i.test(lastUserText)) return OKLCH_ANSWER;
  return SHOWCASE;
};

/** Splits text into small chunks that feel like tokens when streamed. */
const tokenize = (text: string): string[] =>
  text.split(/(?<=\s)/).flatMap((w) => (w.length > 12 ? [w.slice(0, 8), w.slice(8)] : [w]));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface DemoProviderOptions {
  /** Delay between chunks. Playwright/integration tests use 0. */
  delayMs?: number;
}

/**
 * The zero-key "Demo" provider: streams canned markdown as well-formed AG-UI
 * events. Messages containing `error:<kind>` trigger that error, so error
 * cards can be demonstrated (and tested) deterministically.
 */
export async function* demoRun(
  options: StartRunOptions,
  config: DemoProviderOptions = {},
): AsyncIterable<RunEvent> {
  const delayMs = config.delayMs ?? 18;
  const lastUser = [...options.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  const systemText = options.messages.find((m) => m.role === 'system')?.content ?? '';
  const { runId, threadId } = options;

  yield { type: 'RUN_STARTED', runId, threadId, model: 'demo', timestamp: Date.now() };

  const errorMatch = ERROR_TRIGGER.exec(lastUser);
  if (errorMatch) {
    await sleep(delayMs * 4);
    yield {
      type: 'RUN_ERROR',
      runId,
      threadId,
      code: errorMatch[1],
      message: `Demo error requested via "${errorMatch[0]}".`,
      timestamp: Date.now(),
    };
    return;
  }

  const messageId = `${runId}-m0`;
  yield { type: 'TEXT_MESSAGE_START', messageId, role: 'assistant', timestamp: Date.now() };
  let completionTokens = 0;
  for (const delta of tokenize(pickResponse(lastUser, systemText))) {
    if (options.signal?.aborted) throw new DOMException('The run was stopped.', 'AbortError');
    if (delayMs > 0) await sleep(delayMs);
    completionTokens += 1;
    yield { type: 'TEXT_MESSAGE_CONTENT', messageId, delta, timestamp: Date.now() };
  }
  yield { type: 'TEXT_MESSAGE_END', messageId, timestamp: Date.now() };
  // Fabricated-but-plausible usage (≈4 chars/token) so demo traces look like
  // real ones in observability tooling.
  const promptTokens = Math.ceil(
    options.messages.reduce((total, m) => total + m.content.length, 0) / 4,
  );
  yield {
    type: 'RUN_FINISHED',
    runId,
    threadId,
    finishReason: 'stop',
    usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    timestamp: Date.now(),
  };
}
