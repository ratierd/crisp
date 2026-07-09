import { describe, expect, it } from 'vitest';
import { highlightCode } from './highlight';

describe('highlightCode', () => {
  it('tokenizes bare css declarations via a synthetic wrapper, stripped from output', async () => {
    const html = await highlightCode('--accent: oklch(55% 0.19 258); /* brand blue */', 'css');
    // the wrapper never leaks into what the user sees or copies visually
    expect(html).not.toContain(':root');
    expect(html.match(/<span class="line">/g)).toHaveLength(1);
    // the grammar engaged: the property name is its own token, the comment is colored
    expect(html).toContain('>--accent</span>');
    expect(html).toMatch(/--shiki-light:#\w{6}[^>]*>\/\* brand blue \*\//);
  });

  it('keeps multi-line bare css line-accurate', async () => {
    const html = await highlightCode('--a: 1px;\n--b: 2px;\n--c: 3px;', 'css');
    expect(html.match(/<span class="line">/g)).toHaveLength(3);
    expect(html).not.toContain(':root');
  });

  it('leaves well-formed css untouched', async () => {
    const html = await highlightCode('.chat { color: red; }', 'css');
    expect(html).toContain('>.chat</span>');
    expect(html.match(/<span class="line">/g)).toHaveLength(1);
  });

  it('renders dual-theme custom properties without a default color', async () => {
    const html = await highlightCode('const a = 1;', 'ts');
    expect(html).toContain('--shiki-light:');
    expect(html).toContain('--shiki-dark:');
    expect(html).toContain('shiki-themes github-light github-dark');
  });

  it('throws on unknown languages (caller falls back to plain pre)', async () => {
    await expect(highlightCode('x', 'no-such-lang')).rejects.toThrow();
  });
});
