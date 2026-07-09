import type { Message } from '@crisp/conversations/contracts';
import type { UIMessage } from '../client';

/**
 * The wire-Message codec: one module owns the loose shape Messages have on
 * the AG-UI wire — the chat request body and the BYO run report. Encoding
 * (uiMessagesToWire) and reading (readWireMessages) live together so a shape
 * change lands in exactly one place; the server and the browser gateway both
 * read through here instead of keeping parsers of their own.
 */

/** Minimal reading of a wire Message: only role and text content matter. */
interface WireLike {
  id?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  parts?: Array<{ type?: string; content?: string }>;
}

/** One entry of the flattened history a Model receives. */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface WireReading {
  /** Chat-shaped history for the Model; entries with no text are dropped. */
  history: HistoryMessage[];
  /** The trailing user Message of the request, persistable, or null. */
  trailingUserMessage: Message | null;
}

const ANCHOR_ROLES = new Set(['user', 'assistant', 'system']);

/** A `content` string mirror wins; then text parts; then content blocks. */
const wireText = (message: WireLike): string => {
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.parts)) {
    const fromParts = message.parts
      .filter((part) => part.type === 'text' && typeof part.content === 'string')
      .map((part) => part.content)
      .join('');
    if (fromParts.length > 0) return fromParts;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
};

/**
 * One reading of the wire messages: the history to run and the user Message
 * to persist come from the same pass, so they can never diverge. Lenient by
 * design — rejecting an empty history is the caller's transport decision.
 */
export const readWireMessages = (messages: unknown[]): WireReading => {
  const wire = messages as WireLike[];

  const history = wire
    .filter((message) => typeof message.role === 'string' && ANCHOR_ROLES.has(message.role))
    .map((message) => ({
      role: message.role as HistoryMessage['role'],
      content: wireText(message),
    }))
    .filter((message) => message.content.length > 0);

  const last = wire.at(-1);
  let trailingUserMessage: Message | null = null;
  if (last && last.role === 'user') {
    const content = wireText(last);
    if (content.length > 0) {
      trailingUserMessage = {
        id: typeof last.id === 'string' && last.id.length > 0 ? last.id : crypto.randomUUID(),
        role: 'user',
        parts: [{ type: 'text', content }],
        createdAt: new Date().toISOString(),
      };
    }
  }

  return { history, trailingUserMessage };
};

/**
 * UI messages → AG-UI wire format: each message keeps its `parts` and gains
 * a `content` string mirror (the joined text parts), which readWireMessages
 * reads first.
 */
export const uiMessagesToWire = (messages: UIMessage[]): Array<Record<string, unknown>> =>
  messages.map((message) => {
    const text = message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.content)
      .join('');
    return { ...message, content: text };
  });
