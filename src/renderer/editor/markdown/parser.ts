import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnotePlugin from 'markdown-it-footnote';

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false,
})
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
  .use(footnotePlugin);

// Allow data: image URIs (SVG icons, base64-embedded images, etc.)
const defaultValidate = md.validateLink.bind(md);
md.validateLink = (url: string) =>
  /^data:image\//i.test(url) || defaultValidate(url);

// Inside blockquotes, convert soft line breaks to hard breaks so that
// consecutive "> line1\n> line2" lines preserve their visual separation
// instead of being silently merged into one paragraph.
md.core.ruler.push('blockquote_hard_breaks', (state) => {
  let depth = 0;
  for (const token of state.tokens) {
    if (token.type === 'blockquote_open') depth++;
    if (token.type === 'blockquote_close') depth--;
    if (depth > 0 && token.type === 'inline' && token.children) {
      for (const child of token.children) {
        if (child.type === 'softbreak') child.type = 'hardbreak';
      }
    }
  }
});

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

  // Convert inline markover HTML comments to elements TipTap can parse
  html = html.replace(
    /&lt;!-- markover:hl-start id=&quot;([^&]*)&quot; --&gt;/g,
    '<span data-comment-id="$1">',
  );
  html = html.replace(/&lt;!-- markover:hl-end id=&quot;[^&]*&quot; --&gt;/g, '</span>');
  html = html.replace(
    /&lt;!-- markover:ins-start id=&quot;([^&]*)&quot; author=&quot;([^&]*)&quot; date=&quot;([^&]*)&quot; --&gt;/g,
    '<ins data-change-id="$1" data-author="$2" data-date="$3">',
  );
  html = html.replace(/&lt;!-- markover:ins-end id=&quot;[^&]*&quot; --&gt;/g, '</ins>');
  html = html.replace(
    /&lt;!-- markover:del-start id=&quot;([^&]*)&quot; author=&quot;([^&]*)&quot; date=&quot;([^&]*)&quot; --&gt;/g,
    '<del data-change-id="$1" data-author="$2" data-date="$3">',
  );
  html = html.replace(/&lt;!-- markover:del-end id=&quot;[^&]*&quot; --&gt;/g, '</del>');

  // Also handle raw HTML comments (not entity-encoded)
  html = html.replace(
    /<!-- markover:hl-start id="([^"]*)" -->/g,
    '<span data-comment-id="$1">',
  );
  html = html.replace(/<!-- markover:hl-end id="[^"]*" -->/g, '</span>');
  html = html.replace(
    /<!-- markover:ins-start id="([^"]*)" author="([^"]*)" date="([^"]*)" -->/g,
    '<ins data-change-id="$1" data-author="$2" data-date="$3">',
  );
  html = html.replace(/<!-- markover:ins-end id="[^"]*" -->/g, '</ins>');
  html = html.replace(
    /<!-- markover:del-start id="([^"]*)" author="([^"]*)" date="([^"]*)" -->/g,
    '<del data-change-id="$1" data-author="$2" data-date="$3">',
  );
  html = html.replace(/<!-- markover:del-end id="[^"]*" -->/g, '</del>');

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
