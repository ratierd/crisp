// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderMarkdown, splitBlocks } from './markdown';

describe('splitBlocks', () => {
  it('splits paragraphs into separate blocks', () => {
    const blocks = splitBlocks('first paragraph\n\nsecond paragraph');
    expect(blocks).toEqual([
      { type: 'markdown', text: 'first paragraph' },
      { type: 'markdown', text: 'second paragraph' },
    ]);
  });

  it('extracts closed fences as code blocks', () => {
    const blocks = splitBlocks('before\n\n```ts\nconst a = 1;\n```\n\nafter');
    expect(blocks).toEqual([
      { type: 'markdown', text: 'before' },
      { type: 'code', lang: 'ts', code: 'const a = 1;' },
      { type: 'markdown', text: 'after' },
    ]);
  });

  it('flags a trailing unclosed fence as open-code (streaming)', () => {
    const blocks = splitBlocks('intro\n\n```python\nprint("hi")\nx = ');
    expect(blocks.at(-1)).toEqual({ type: 'open-code', lang: 'python', code: 'print("hi")\nx = ' });
  });

  it('keeps blank lines inside fences', () => {
    const blocks = splitBlocks('```\na\n\nb\n```');
    expect(blocks).toEqual([{ type: 'code', lang: '', code: 'a\n\nb' }]);
  });

  it('keeps multi-line constructs (lists, tables) in one block', () => {
    const blocks = splitBlocks('- one\n- two\n- three');
    expect(blocks).toHaveLength(1);
  });

  it('handles empty and whitespace-only input', () => {
    expect(splitBlocks('')).toEqual([]);
    expect(splitBlocks('  \n\n  ')).toEqual([]);
  });

  it('is stable over a growing stream (prefix blocks unchanged)', () => {
    const partial = splitBlocks('para one\n\npara two is grow');
    const grown = splitBlocks('para one\n\npara two is growing longer');
    expect(grown[0]).toEqual(partial[0]);
  });
});

describe('renderMarkdown', () => {
  it('renders basic markdown', () => {
    const html = renderMarkdown('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('escapes raw HTML from the model (no live elements)', () => {
    const html = renderMarkdown('hello <script>alert(1)</script> <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;'); // survives as inert text
  });

  it('refuses javascript: links (stays literal text, no href)', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
  });

  it('renders tables', () => {
    const html = renderMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>1</td>');
  });
});
