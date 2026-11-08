import MarkdownIt from 'markdown-it';
import taskLists from 'markdown-it-task-lists';
import footnotePlugin from 'markdown-it-footnote';

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false,
})
  .use(taskLists, { enabled: true })
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

md.core.ruler.after('inline', 'recover_malformed_strong_with_boundary_space', (state) => {
  for (const token of state.tokens) {
    if (token.type !== 'inline' || !token.children) continue;

    const children: typeof token.children = [];
    let text = '';

    const flushText = () => {
      if (!text) return;
      children.push(...recoverMalformedStrongText(text, (type, tag, nesting) =>
        new state.Token(type, tag, nesting),
      ));
      text = '';
    };

    for (const child of token.children) {
      if (child.type === 'text' || child.type === 'text_special') {
        text += child.content;
      } else {
        flushText();
        children.push(child);
      }
    }
    flushText();

    token.children = children;
  }
});

// markdown-it-task-lists tags task list tokens (class "contains-task-list" on the
// <ul>, class "task-list-item enabled" on each <li>) and injects an html_inline
// checkbox token as the first child of the item's inline content. TipTap's
// TaskList/TaskItem extensions instead want <ul data-type="taskList"> and
// <li data-type="taskItem" data-checked="true|false"><p>…</p></li>.
// Rewrite the token stream (not the rendered HTML) so nested and loose task lists
// — which the old regex approach mangled — convert correctly.
//
// Looseness is detected at parse time (before we un-hide paragraph tokens) by
// scanning the token range for this list and checking whether any paragraph_open
// at the direct item level (not inside a nested sub-list) has hidden === false.
// markdown-it sets hidden=true on paragraph tokens inside tight lists and
// hidden=false for loose lists, so this is authoritative.
md.core.ruler.after('github-task-lists', 'markover_task_items', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === 'bullet_list_open' && /\bcontains-task-list\b/.test(tok.attrGet('class') || '')) {
      // Determine whether this task list is loose BEFORE un-hiding paragraph
      // tokens below. Scan from here to the matching bullet_list_close, tracking
      // nesting depth. A paragraph_open seen at depth 1 (directly inside this
      // list's own list_item_open tokens, not inside a nested sub-list) with
      // hidden === false indicates a loose list.
      let listDepth = 0;
      let isLoose = false;
      for (let j = i; j < tokens.length; j++) {
        const t = tokens[j];
        if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') listDepth++;
        if (t.type === 'bullet_list_close' || t.type === 'ordered_list_close') {
          listDepth--;
          if (listDepth === 0) break; // reached the end of this list
        }
        // Only look at paragraph_open tokens directly inside this list (depth 1)
        if (listDepth === 1 && t.type === 'paragraph_open' && t.hidden === false) {
          isLoose = true;
          break;
        }
      }

      tok.attrSet('data-type', 'taskList');
      if (isLoose) tok.attrSet('data-loose', 'true');
      continue;
    }

    if (tok.type === 'list_item_open' && /\btask-list-item\b/.test(tok.attrGet('class') || '')) {
      // The structure is: list_item_open [i], paragraph_open [i+1], inline [i+2], paragraph_close [i+3]
      const paraOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      let checked = false;

      if (inline && inline.type === 'inline' && inline.children && inline.children.length) {
        const first = inline.children[0];
        if (first.type === 'html_inline' && /task-list-item-checkbox/.test(first.content)) {
          checked = /\bchecked\b/.test(first.content);
          inline.children.shift(); // drop the raw <input> token
          // The plugin leaves a single leading space after the checkbox marker.
          const nextChild = inline.children[0];
          if (nextChild && nextChild.type === 'text') {
            nextChild.content = nextChild.content.replace(/^\s/, '');
          }
        }
      }

      tok.attrSet('data-type', 'taskItem');
      tok.attrSet('data-checked', checked ? 'true' : 'false');

      // Tight lists hide the wrapping <p>; force a real paragraph so TipTap sees
      // block content inside the task item.
      const paraClose = tokens[i + 3];
      if (paraOpen && paraOpen.type === 'paragraph_open') paraOpen.hidden = false;
      if (paraClose && paraClose.type === 'paragraph_close') paraClose.hidden = false;
    }
  }
});

// Tracked block and paragraph-break changes (see extensions/block-changes.ts).
// The serializer writes them as HTML markers next to the block:
//   <div data-markov="block" data-op="ins|del" ...></div>   (own HTML block, before a
//                                                             code/math/Mermaid block or rule)
//   <span data-markov="para" data-op="split|join" ...></span> (start of a paragraph/heading)
// Fold each marker into a data-markov-* JSON attribute on the block it belongs
// to, which the TipTap attribute parsers read back.
const BLOCK_MARKER_RE = /<div data-markov="block"([^>]*)><\/div>/g;
const PARA_MARKER_RE = /^<span data-markov="para"([^>]*)>$/;
const BLOCK_ATTR: Record<string, string> = { ins: 'data-markov-block-ins', del: 'data-markov-block-del' };
const PARA_ATTR: Record<string, string> = { split: 'data-markov-split', join: 'data-markov-join' };

function readMarkerAttrs(attrText: string): { op: string; json: string } | null {
  const get = (name: string) => {
    const m = attrText.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
    return m ? decodeEntities(m[1]) : '';
  };
  const op = get('data-op');
  const changeId = get('data-change-id');
  if (!op || !changeId) return null;
  const ws = get('data-ws');
  const change = { changeId, author: get('data-author'), date: get('data-date'), ...(ws ? { ws } : {}) };
  return { op, json: JSON.stringify(change) };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#124;/g, '|')
    .replace(/&amp;/g, '&');
}

md.core.ruler.push('markover_block_changes', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'html_block' && tok.content.includes('data-markov="block"')) {
      const rest = tok.content.replace(BLOCK_MARKER_RE, '').trim();
      const next = tokens[i + 1];
      const setAttr = rest ? null : blockMarkerTarget(tokens, i + 1);
      if (!setAttr) continue;
      for (const m of tok.content.matchAll(BLOCK_MARKER_RE)) {
        const attrs = readMarkerAttrs(m[1]);
        if (attrs && BLOCK_ATTR[attrs.op]) setAttr(BLOCK_ATTR[attrs.op], attrs.json);
      }
      tokens.splice(i, 1);
      i--;
      continue;
    }
    if (tok.type !== 'inline' || !tok.children) continue;
    const open = tokens[i - 1];
    if (!open || (open.type !== 'paragraph_open' && open.type !== 'heading_open')) continue;
    let found = false;
    for (;;) {
      const [a, b] = tok.children;
      if (!a || !b || a.type !== 'html_inline' || b.type !== 'html_inline' || b.content !== '</span>') break;
      const m = a.content.match(PARA_MARKER_RE);
      if (!m) break;
      const attrs = readMarkerAttrs(m[1]);
      if (attrs && PARA_ATTR[attrs.op]) open.attrSet(PARA_ATTR[attrs.op], attrs.json);
      tok.children.splice(0, 2);
      found = true;
    }
    if (found && open.hidden) {
      // Tight list items hide their <p>; the attribute needs a real element.
      open.hidden = false;
      const close = tokens[i + 1];
      if (close && close.type === 'paragraph_close') close.hidden = false;
    }
  }
});

type MdToken = ReturnType<typeof md.parse>[number];

/**
 * Where a block marker's attributes go: the following fence / math block /
 * rule, or the image of a paragraph that holds only an image (block images).
 */
function blockMarkerTarget(tokens: MdToken[], j: number): ((name: string, value: string) => void) | null {
  const next = tokens[j];
  if (!next) return null;
  if (['fence', 'katex_block', 'hr', 'code_block'].includes(next.type)) {
    return (name, value) => next.attrSet(name, value);
  }
  const inline = tokens[j + 1];
  if (next.type !== 'paragraph_open' || inline?.type !== 'inline' || !inline.children) return null;
  const img = inline.children.find((c) => c.type === 'image' || (c.type === 'html_inline' && /^<img\s/i.test(c.content)));
  if (!img) return null;
  if (img.type === 'image') return (name, value) => img.attrSet(name, value);
  return (name, value) => {
    img.content = img.content.replace(/^<img\s/i, `<img ${name}="${escapeAttr(value)}" `);
  };
}

/** Attributes set by markover_block_changes, rendered onto a custom block element. */
function blockChangeAttrs(token: { attrGet: (name: string) => string | null }): string {
  let out = '';
  for (const name of Object.values(BLOCK_ATTR)) {
    const v = token.attrGet(name);
    if (v) out += ` ${name}="${escapeAttr(v)}"`;
  }
  return out;
}

// Custom rule: inline math $...$
md.inline.ruler.after('escape', 'katex_inline', (state, silent) => {
  if (state.src[state.pos] !== '$' || state.src[state.pos + 1] === '$') return false;

  const start = state.pos + 1;
  if (start >= state.posMax || /\s/.test(state.src[start])) return false;
  let end = start;
  while (end < state.posMax && state.src[end] !== '$') {
    if (state.src[end] === '\\') end++; // skip escaped
    end++;
  }
  if (end >= state.posMax) return false;
  // A closing delimiter cannot follow whitespace or start another price.
  // This keeps "$10 and $20" as prose while still allowing "$5$" formulas.
  if (end === start || /\s/.test(state.src[end - 1]) || /\d/.test(state.src[end + 1] ?? '')) return false;

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
  return `<div data-katex-block="${escapeAttr(math)}"${blockChangeAttrs(tokens[idx])}>${escapeHtml(math)}</div>\n`;
};

// Mermaid: fenced code blocks with language "mermaid" → custom node
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === 'mermaid') {
    const code = token.content;
    return `<div data-mermaid="${escapeAttr(code)}"${blockChangeAttrs(token)}>${escapeHtml(code)}</div>\n`;
  }
  // Change attributes belong on <pre> (the code block element), not <code>.
  const changeAttrs = blockChangeAttrs(token);
  if (!changeAttrs) return defaultFence(tokens, idx, options, env, self);
  for (const name of Object.values(BLOCK_ATTR)) {
    const i = token.attrIndex(name);
    if (i >= 0) token.attrs?.splice(i, 1);
  }
  return defaultFence(tokens, idx, options, env, self).replace(/^<pre/, `<pre${changeAttrs}`);
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

  // markdown-it-footnote emits:
  //   <hr class="footnotes-sep">
  //   <section class="footnotes"><ol class="footnotes-list">
  //     <li class="footnote-item">…</li>
  //   </ol></section>
  // TipTap parses the <hr> as a horizontalRule and the <ol> as an orderedList,
  // burying the footnote definitions. Strip the entire wrapper in one pass,
  // keeping just the inner <li class="footnote-item"> blocks so the
  // FootnoteBlock extension can pick them up. Also strip the auto-generated
  // backref anchor inside each footnote.
  html = html.replace(
    /<hr class="footnotes-sep"[^>]*>\s*<section class="footnotes">\s*<ol class="footnotes-list">\s*([\s\S]*?)\s*<\/ol>\s*<\/section>/g,
    '$1',
  );
  html = html.replace(/\s*<a href="#fnref[^"]*" class="footnote-backref">[^<]*<\/a>/g, '');

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

type TokenNesting = -1 | 0 | 1;

function recoverMalformedStrongText<T extends { content: string; markup: string }>(
  content: string,
  makeToken: (type: string, tag: string, nesting: TokenNesting) => T,
): T[] {
  const tokens: T[] = [];
  let position = 0;

  const pushText = (text: string) => {
    if (!text) return;
    const token = makeToken('text', '', 0);
    token.content = text;
    tokens.push(token);
  };

  while (position < content.length) {
    const start = content.indexOf('**', position);
    if (start === -1) {
      pushText(content.slice(position));
      break;
    }

    let searchFrom = start + 2;
    let recovered = false;
    while (searchFrom < content.length) {
      const end = content.indexOf('**', searchFrom);
      if (end === -1) break;

      const inner = content.slice(start + 2, end);
      const leadingSpace = inner.match(/^\s*/)?.[0] ?? '';
      const trailingSpace = inner.match(/\s*$/)?.[0] ?? '';
      const text = inner.trim();

      if (text && (leadingSpace || trailingSpace)) {
        pushText(content.slice(position, start) + leadingSpace);

        const open = makeToken('strong_open', 'strong', 1);
        open.markup = '**';
        tokens.push(open);

        pushText(text);

        const close = makeToken('strong_close', 'strong', -1);
        close.markup = '**';
        tokens.push(close);

        pushText(trailingSpace);
        position = end + 2;
        recovered = true;
        break;
      }

      searchFrom = end + 2;
    }

    if (!recovered) {
      pushText(content.slice(position, start + 2));
      position = start + 2;
    }
  }

  return tokens;
}
