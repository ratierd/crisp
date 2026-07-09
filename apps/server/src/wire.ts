import type { Message } from '@crisp/contracts';
import type { GatewayMessage } from '@crisp/domain';

/**
 * Minimal reading of AG-UI wire messages (see uiMessagesToWire in
 * @crisp/ai): anchor messages carry `parts` plus a `content` mirror.
 * Anything that isn't user/assistant/system text is ignored.
 */
interface WireLike {
  id?: string;
  role?: string;
  content?: string | Array<{ type?: string; text?: string }>;
  parts?: Array<{ type?: string; content?: string }>;
}

const ANCHOR_ROLES = new Set(['user', 'assistant', 'system']);

export const wireText = (message: WireLike): string => {
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

export const toGatewayHistory = (wireMessages: unknown[]): GatewayMessage[] =>
  (wireMessages as WireLike[])
    .filter((message) => typeof message.role === 'string' && ANCHOR_ROLES.has(message.role))
    .map((message) => ({
      role: message.role as GatewayMessage['role'],
      content: wireText(message),
    }))
    .filter((message) => message.content.length > 0);

/** The trailing user message of the request, as a persistable Message. */
export const trailingUserMessage = (wireMessages: unknown[]): Message | null => {
  const last = (wireMessages as WireLike[]).at(-1);
  if (!last || last.role !== 'user') return null;
  const content = wireText(last);
  if (content.length === 0) return null;
  return {
    id: typeof last.id === 'string' && last.id.length > 0 ? last.id : crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', content }],
    createdAt: new Date().toISOString(),
  };
};
