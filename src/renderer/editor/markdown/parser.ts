import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnotePlugin from 'markdown-it-footnote';

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: false,
  breaks: false,
})
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
  .use(footnotePlugin);

// Custom rule: inline math $...$
md.inline.ruler.after('escape', 'katex_inline', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;

  const start = state.pos + 1;
  let end = start;
  while (end < state.posMax && state.src[end] !== '$') {
    if (state.src[end] === '\\') end++; // skip escaped
    end++;
  }
  if (end >= state.posMax) return false;

  if (!silent) {
    const token = state.push('katex_inline', 'span', 0);
    token.content = state.src.slice(start, end);
  }

  state.pos = end + 1;
  return true;
});

md.renderer.rules.katex_inline = (tokens, idx) => {
  const math = tokens[idx].content;
  return `<span data-katex-inline="${escapeAttr(math)}">${escapeHtml(math)}</span>`;
};

// Custom rule: block math $$...$$
md.block.ruler.before('fence', 'katex_block', (state, startLine, endLine, silent) => {
  const startPos = state.bMarks[startLine] + state.tShift[startLine];
  if (state.src.slice(startPos, startPos + 2) !== '$$') return false;

  if (silent) return true;

  let nextLine = startLine + 1;
  while (nextLine < endLine) {
    const pos = state.bMarks[nextLine] + state.tShift[nextLine];
    if (state.src.slice(pos, pos + 2) === '$$') break;
    nextLine++;
  }

  const content = state.getLines(startLine + 1, nextLine, state.tShift[startLine], false).trim();
  const token = state.push('katex_block', 'div', 0);
  token.content = content;
  token.map = [startLine, nextLine + 1];

  state.line = nextLine + 1;
  return true;
});

md.renderer.rules.katex_block = (tokens, idx) => {
  const math = tokens[idx].content;
  return `<div data-katex-block="${escapeAttr(math)}">${escapeHtml(math)}</div>\n`;
};

// Mermaid: fenced code blocks with language "mermaid" → custom node
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    const code = token.content;
    return `<div data-mermaid="${escapeAttr(code)}">${escapeHtml(code)}</div>\n`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

/**
 * Parse markdown string to HTML that TipTap can consume.
 * Extracts YAML front matter first.
 */
export function markdownToHtml(markdown: string): string {
  let html = '';
  const { frontMatter, body } = extractFrontMatter(markdown);

  if (frontMatter) {
    html += `<div data-front-matter="${escapeAttr(frontMatter)}">${escapeHtml(frontMatter)}</div>`;
  }

  html += md.render(body);
  return html;
}

function extractFrontMatter(markdown: string): { frontMatter: string | null; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return { frontMatter: null, body: markdown };
  return {
    frontMatter: match[1],
    body: markdown.slice(match[0].length),
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
