import DOMPurify from 'dompurify';
import MarkdownIt from 'markdown-it';

/**
 * Streaming-aware markdown pipeline. The source is split into top-level
 * blocks so that, while streaming, only the growing tail block re-renders
 * (the component memoizes per block text). Fenced code is extracted here —
 * closed fences get the Shiki code-block component, an unclosed trailing
 * fence renders as a plain <pre> until it closes.
 */

export type Block =
  | { type: 'markdown'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'open-code'; lang: string; code: string };

const FENCE = /^(```+|~~~+)\s*(\S*)\s*$/;

export const splitBlocks = (source: string): Block[] => {
  const blocks: Block[] = [];
  const lines = source.split('\n');
  let plain: string[] = [];
  let fence: { marker: string; lang: string; lines: string[] } | null = null;

  const flushPlain = () => {
    const text = plain.join('\n').trim();
    if (text.length > 0) blocks.push({ type: 'markdown', text });
    plain = [];
  };

  for (const line of lines) {
    if (fence) {
      if (line.trimEnd().startsWith(fence.marker)) {
        blocks.push({ type: 'code', lang: fence.lang, code: fence.lines.join('\n') });
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const match = FENCE.exec(line);
    if (match) {
      flushPlain();
      fence = { marker: match[1]!, lang: match[2] ?? '', lines: [] };
      continue;
    }
    if (line.trim() === '') {
      // paragraph boundary: split here so earlier blocks stay memoized
      flushPlain();
    } else {
      plain.push(line);
    }
  }

  if (fence) {
    blocks.push({ type: 'open-code', lang: fence.lang, code: fence.lines.join('\n') });
  } else {
    flushPlain();
  }
  return blocks;
};

const CLOSING_TAG = /(<\/(?:p|h[1-6]|li|blockquote|em|strong|td|ul|ol)>\s*)$/;

/** Inlines the streaming caret after the last rendered character. */
export const injectCaret = (html: string): string => {
  const caret = '<span class="stream-caret"></span>';
  if (CLOSING_TAG.test(html)) {
    // place the caret inside the innermost final element, e.g. …caret</p>
    return html.replace(/(<\/[a-z0-9]+>\s*)+$/, (tail) => {
      const firstClose = tail.indexOf('</');
      return tail.slice(0, firstClose) + caret + tail.slice(firstClose);
    });
  }
  return html + caret;
};

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
});

// LLM output is untrusted: markdown-it already escapes raw HTML (html:false),
// DOMPurify guards the rest (e.g. crafted link protocols).
const renderCache = new Map<string, string>();
const CACHE_CAP = 500;

export const renderMarkdown = (text: string): string => {
  const cached = renderCache.get(text);
  if (cached !== undefined) return cached;
  const rendered = DOMPurify.sanitize(md.render(text));
  if (renderCache.size >= CACHE_CAP) {
    const oldest = renderCache.keys().next().value;
    if (oldest !== undefined) renderCache.delete(oldest);
  }
  renderCache.set(text, rendered);
  return rendered;
};
