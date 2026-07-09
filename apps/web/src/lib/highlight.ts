import type { ShikiTransformer } from 'shiki';

/**
 * Shiki's CSS grammar only tokenizes declarations inside a selector block,
 * but models often emit bare `--prop: value;` snippets (no `:root { }`),
 * which then render as near-plain text. Wrap those in a synthetic `:root { }`
 * so the grammar engages, then strip the wrapper lines from the output.
 */
const isBareCss = (lang: string, code: string): boolean => lang === 'css' && !/[{}]/.test(code);

const stripWrapperLines: ShikiTransformer = {
  code(node) {
    const lines = node.children.filter((c) => c.type === 'element');
    const wrapper = new Set<(typeof node.children)[number] | undefined>([lines[0], lines.at(-1)]);
    node.children = node.children.filter((c) => !wrapper.has(c));
    // the removed lines leave their '\n' separators dangling at the edges
    if (node.children[0]?.type === 'text') node.children.shift();
    if (node.children.at(-1)?.type === 'text') node.children.pop();
  },
};

/** Dual-theme Shiki render; shiki stays lazy-loaded (it's the heaviest dep). */
export const highlightCode = async (code: string, lang: string): Promise<string> => {
  const { codeToHtml } = await import('shiki');
  const bare = isBareCss(lang, code);
  return codeToHtml(bare ? `:root {\n${code}\n}` : code, {
    lang: lang || 'text',
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    transformers: bare ? [stripWrapperLines] : [],
  });
};
