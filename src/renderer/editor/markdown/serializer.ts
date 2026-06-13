import type { Node, Mark } from '@tiptap/pm/model';

/**
 * Serialize a ProseMirror document to markdown.
 */
export function prosemirrorToMarkdown(doc: Node): string {
  const state = new MarkdownSerializerState();
  // Route through the doc handler so it can skip top-level artifacts (e.g.
  // empty paragraphs left behind when block-level images are extracted from
  // their <p> wrappers during parsing).
  nodeHandlers.doc(state, doc, doc, 0);
  return state.getOutput();
}

// --- Mark comparison ---

function marksEqual(a: Mark, b: Mark): boolean {
  if (a.type.name !== b.type.name) return false;
  const aAttrs = a.attrs as Record<string, unknown>;
  const bAttrs = b.attrs as Record<string, unknown>;
  const keys = Object.keys(aAttrs);
  if (keys.length !== Object.keys(bAttrs).length) return false;
  return keys.every((k) => aAttrs[k] === bAttrs[k]);
}

function markSetsEqual(a: readonly Mark[], b: readonly Mark[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((mark, i) => marksEqual(mark, b[i]));
}

function isFlankingSensitiveMark(mark: Mark): boolean {
  return ['bold', 'strong', 'italic', 'em', 'strike'].includes(mark.type.name);
}

interface TextUnit {
  kind: 'text';
  text: string;
  marks: Mark[];
}

interface LeafUnit {
  kind: 'leaf';
  node: Node;
}

type InlineUnit = TextUnit | LeafUnit;

class MarkdownSerializerState {
  private output = '';
  private closed = false;

  getOutput(): string {
    return this.output.replace(/\n$/, '\n');
  }

  write(content: string) {
    this.output += content;
  }

  ensureNewLine() {
    if (!this.output.endsWith('\n')) {
      this.output += '\n';
    }
  }

  endsWithBlankLine(): boolean {
    return this.output.endsWith('\n\n');
  }

  closeBlock() {
    this.ensureNewLine();
    if (!this.output.endsWith('\n\n') && this.output.length > 0) {
      this.output += '\n';
    }
    this.closed = true;
  }

  renderContent(parent: Node) {
    parent.forEach((child, _offset, index) => {
      this.renderNode(child, parent, index);
    });
  }

  renderNode(node: Node, parent: Node, index: number) {
    const handler = nodeHandlers[node.type.name];
    if (handler) {
      handler(this, node, parent, index);
    } else {
      this.renderInline(node);
    }
  }

  renderInline(node: Node) {
    if (node.isText) {
      this.renderMarkedText(node);
    } else if (node.isLeaf) {
      const handler = nodeHandlers[node.type.name];
      if (handler) {
        handler(this, node, node, 0);
      }
    } else {
      node.forEach((child) => {
        this.renderInline(child);
      });
    }
  }

  private renderMarkedText(node: Node) {
    const marks = node.marks;
    for (const mark of marks) {
      const wrapper = getMarkWrapper(mark);
      if (wrapper) this.write(wrapper.open);
    }
    this.write(escapeMarkdown(node.text || '', marks));
    for (let i = marks.length - 1; i >= 0; i--) {
      const wrapper = getMarkWrapper(marks[i]);
      if (wrapper) this.write(wrapper.close);
    }
  }

  /**
   * Render all inline children of a node using mark diffing.
   *
   * Instead of opening/closing marks per text run in isolation, we track which
   * marks are currently "open" and only transition the delta between runs. This
   * produces correct output for patterns like _italic **bold** italic_ where
   * the outer italic mark stays open across the bold span.
   */
  renderInlineContent(node: Node) {
    const openMarks: Mark[] = [];

    const transitionTo = (newMarks: readonly Mark[]) => {
      // Find the shallowest open mark that is no longer needed
      let closeFrom = openMarks.length;
      for (let i = 0; i < openMarks.length; i++) {
        if (!newMarks.some((n) => marksEqual(n, openMarks[i]))) {
          closeFrom = i;
          break;
        }
      }

      // Close marks from innermost back to closeFrom; collect those to reopen
      const toReopen: Mark[] = [];
      for (let i = openMarks.length - 1; i >= closeFrom; i--) {
        const wrapper = getMarkWrapper(openMarks[i]);
        if (wrapper) this.write(wrapper.close);
        if (newMarks.some((n) => marksEqual(n, openMarks[i]))) {
          toReopen.unshift(openMarks[i]);
        }
      }
      openMarks.splice(closeFrom);

      // Re-establish marks that were closed but are still needed
      for (const mark of toReopen) {
        const wrapper = getMarkWrapper(mark);
        if (wrapper) this.write(wrapper.open);
        openMarks.push(mark);
      }

      // Open any newly required marks
      for (const mark of newMarks) {
        if (!openMarks.some((o) => marksEqual(o, mark))) {
          const wrapper = getMarkWrapper(mark);
          if (wrapper) this.write(wrapper.open);
          openMarks.push(mark);
        }
      }
    };

    const units = getInlineUnitsWithMarkdownSafeMarks(node);
    let pendingText = '';
    let pendingMarks: readonly Mark[] = [];

    const flushText = () => {
      if (!pendingText) return;
      transitionTo(pendingMarks);
      this.write(escapeMarkdown(pendingText, pendingMarks));
      pendingText = '';
    };

    for (const unit of units) {
      if (unit.kind === 'text') {
        if (pendingText && !markSetsEqual(pendingMarks, unit.marks)) {
          flushText();
        }
        pendingText += unit.text;
        pendingMarks = unit.marks;
      } else {
        flushText();
        // For inline leaf nodes (hardBreak, katexInline, etc.) close all marks first
        transitionTo([]);
        const handler = nodeHandlers[unit.node.type.name];
        if (unit.node.isLeaf && handler) {
          handler(this, unit.node, node, 0);
        } else {
          unit.node.forEach((grandchild) => this.renderInline(grandchild));
        }
      }
    }
    flushText();

    // Close any remaining open marks
    transitionTo([]);
  }

  renderList(node: Node, prefix: (index: number) => string) {
    // A list is "loose" only if any item has more than one non-empty paragraph.
    // Nested lists and other block children inside a list item do not make the
    // outer list loose — they're rendered inline (continuation indent) without
    // surrounding blank lines, which matches CommonMark's tight-list rendering.
    let isLoose = false;
    node.forEach((item) => {
      let paragraphs = 0;
      item.forEach((child) => {
        if (child.type.name === 'paragraph' && child.childCount > 0) paragraphs++;
      });
      if (paragraphs > 1) isLoose = true;
    });

    node.forEach((child, _offset, index) => {
      // Blank line between loose list items
      if (index > 0 && isLoose && !this.output.endsWith('\n\n')) {
        this.ensureNewLine();
        this.write('\n');
      }
      this.write(prefix(index));
      this.renderListItem(child, isLoose);
    });

    if (!this.output.endsWith('\n\n')) {
      this.ensureNewLine();
      this.write('\n');
    }
  }

  private renderListItem(node: Node, isLoose = false) {
    let first = true;

    node.forEach((child) => {
      // Skip empty paragraphs — these are artifacts left when ProseMirror extracts
      // block-level nodes (e.g. images) out of their <p> wrapper during parsing.
      if (child.type.name === 'paragraph' && child.childCount === 0) return;

      if (child.type.name === 'paragraph') {
        if (!first) {
          // Blank line before non-first paragraphs in a loose item
          if (isLoose && !this.output.endsWith('\n\n')) {
            this.ensureNewLine();
            this.write('\n');
          }
          this.write('  '); // continuation indent
        }
        this.renderInlineContent(child);
        this.ensureNewLine();
      } else {
        // Block child (nested list, image, etc.) — render into sub-state
        // and re-indent every line by two spaces, leaving blank lines blank
        if (isLoose && !this.output.endsWith('\n\n')) {
          this.ensureNewLine();
          this.write('\n');
        }
        const inner = new MarkdownSerializerState();
        inner.renderNode(child, node, 0);
        const raw = inner.getOutput().replace(/\n+$/, '');
        for (const line of raw.split('\n')) {
          // Non-empty lines get the continuation indent; blank lines stay blank
          if (line.length > 0) this.write('  ' + line);
          this.ensureNewLine();
        }
      }
      first = false;
    });
  }
}

// --- Node Handlers ---

type NodeHandler = (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void;

const nodeHandlers: Record<string, NodeHandler> = {
  doc(state, node) {
    node.forEach((child, _offset, index) => {
      // Skip empty paragraphs that ProseMirror leaves behind when block-level
      // nodes (e.g. images) are extracted from their <p> wrapper during parsing.
      if (child.type.name === 'paragraph' && child.childCount === 0) return;
      state.renderNode(child, node, index);
    });
  },

  paragraph(state, node, parent) {
    state.renderInlineContent(node);
    // Don't add blank line if inside a list item
    if (parent.type.name === 'listItem' || parent.type.name === 'taskItem') {
      state.ensureNewLine();
    } else {
      state.closeBlock();
    }
  },

  heading(state, node) {
    const level = node.attrs.level as number;
    state.write('#'.repeat(level) + ' ');
    state.renderInlineContent(node);
    state.closeBlock();
  },

  bulletList(state, node) {
    state.renderList(node, () => '- ');
  },

  orderedList(state, node) {
    const start = (node.attrs.start as number) || 1;
    state.renderList(node, (i) => `${start + i}. `);
  },

  listItem(_state, _node) {
    // Handled by renderList
  },

  taskList(state, node) {
    // Looseness is recorded at parse time via the `loose` attribute (set by the
    // parser's markover_task_items rule from markdown-it's hidden-token signal).
    // We also treat any item with more than one non-empty paragraph as loose —
    // this covers documents edited in-app where the user adds a second paragraph.
    // Nested lists do NOT make the parent loose (CLAUDE.md convention).
    let isLoose = node.attrs.loose === true;
    if (!isLoose) {
      node.forEach((item) => {
        let paragraphs = 0;
        item.forEach((child) => {
          if (child.type.name === 'paragraph' && child.childCount > 0) paragraphs++;
        });
        if (paragraphs > 1) isLoose = true;
      });
    }

    node.forEach((child, _offset, itemIndex) => {
      // Blank line between loose task items
      if (itemIndex > 0 && isLoose && !state.endsWithBlankLine()) {
        state.ensureNewLine();
        state.write('\n');
      }
      const checked = child.attrs.checked as boolean;
      state.write(checked ? '- [x] ' : '- [ ] ');
      // Render task item children
      let first = true;
      child.forEach((grandchild) => {
        if (grandchild.type.name === 'paragraph') {
          if (!first) {
            if (isLoose && !state.endsWithBlankLine()) {
              state.ensureNewLine();
              state.write('\n');
            }
            state.write('  ');
          }
          state.renderInlineContent(grandchild);
          state.ensureNewLine();
        } else {
          // Block child (nested list, etc.) — render into sub-state and re-indent
          const inner = new MarkdownSerializerState();
          inner.renderNode(grandchild, child, 0);
          const raw = inner.getOutput().replace(/\n+$/, '');
          for (const line of raw.split('\n')) {
            if (line.length > 0) state.write('  ' + line);
            state.ensureNewLine();
          }
        }
        first = false;
      });
    });
    state.closeBlock();
  },

  taskItem(_state, _node) {
    // Handled by taskList
  },

  codeBlock(state, node) {
    const language = (node.attrs.language as string) || '';
    const content = node.textContent;
    // Use a fence longer than any backtick run inside the content
    const maxRun = (content.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 2);
    const fence = '`'.repeat(maxRun + 1);
    state.write(fence + language + '\n');
    state.write(content);
    state.ensureNewLine();
    state.write(fence);
    state.closeBlock();
  },

  blockquote(state, node) {
    const inner = new MarkdownSerializerState();
    inner.renderContent(node);
    const lines = inner.getOutput().replace(/\n+$/, '').split('\n');
    for (const line of lines) {
      // Strip the "  " hard-break trailing spaces inside a blockquote — the
      // parser's blockquote_hard_breaks rule re-adds them on load, so leaving
      // them in source would inflate the file two characters per line on
      // every save.
      const stripped = line.replace(/ {2,}$/, '');
      state.write(stripped.length > 0 ? '> ' + stripped : '>');
      state.ensureNewLine();
    }
    state.closeBlock();
  },

  horizontalRule(state) {
    state.write('---');
    state.closeBlock();
  },

  hardBreak(state) {
    state.write('  \n');
  },

  image(state, node) {
    const alt = (node.attrs.alt as string) || '';
    const src = node.attrs.src as string;
    const title = node.attrs.title as string;
    const width = node.attrs.width as string | null;
    const href = node.attrs.href as string | null;

    // Emit HTML img tag when a custom width is set so it round-trips cleanly
    let imageStr: string;
    if (width) {
      const titleAttr = title ? ` title="${title}"` : '';
      imageStr = `<img src="${src}" alt="${alt}"${titleAttr} width="${width}">`;
    } else {
      // Wrap src in angle brackets if it contains whitespace (CommonMark-compatible)
      const srcStr = /\s/.test(src) ? `<${src}>` : src;
      imageStr = `![${alt}](${srcStr}${title ? ` "${title}"` : ''})`;
    }

    // Wrap in link syntax when the image was originally [![alt](src)](href)
    if (href) {
      state.write(`[${imageStr}](${href})`);
    } else {
      state.write(imageStr);
    }

    // Block-level images need a blank line after them (inline images do not)
    if (node.isBlock) {
      state.closeBlock();
    }
  },

  text(state, node) {
    state.write(node.text || '');
  },

  // Table support
  table(state, node) {
    const rows: Node[] = [];
    node.forEach((row) => rows.push(row));

    if (rows.length === 0) return;

    // Render header row
    const headerRow = rows[0];
    state.write('| ');
    headerRow.forEach((cell, _offset, i) => {
      if (i > 0) state.write(' | ');
      const inner = new MarkdownSerializerState();
      inner.renderInlineContent(cell.firstChild || cell);
      state.write(inner.getOutput().trim());
    });
    state.write(' |');
    state.ensureNewLine();

    // Separator row — emit alignment markers based on cell align attribute
    state.write('| ');
    headerRow.forEach((cell, _offset, i) => {
      if (i > 0) state.write(' | ');
      const align = cell.attrs.align as string | null;
      if (align === 'center') state.write(':---:');
      else if (align === 'right') state.write('---:');
      else if (align === 'left') state.write(':---');
      else state.write('---');
    });
    state.write(' |');
    state.ensureNewLine();

    // Data rows
    for (let r = 1; r < rows.length; r++) {
      state.write('| ');
      rows[r].forEach((cell, _offset, i) => {
        if (i > 0) state.write(' | ');
        const inner = new MarkdownSerializerState();
        inner.renderInlineContent(cell.firstChild || cell);
        state.write(inner.getOutput().trim());
      });
      state.write(' |');
      state.ensureNewLine();
    }
    state.closeBlock();
  },

  tableRow() { /* handled by table */ },
  tableCell() { /* handled by table */ },
  tableHeader() { /* handled by table */ },

  // KaTeX
  katexInline(state, node) {
    state.write(`$${node.attrs.math}$`);
  },

  katexBlock(state, node) {
    state.write('$$\n');
    state.write(node.attrs.math);
    state.ensureNewLine();
    state.write('$$');
    state.closeBlock();
  },

  // Mermaid
  mermaidBlock(state, node) {
    state.write('```mermaid\n');
    state.write(node.attrs.code);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock();
  },

  // Front matter
  frontMatter(state, node) {
    state.write('---\n');
    state.write(node.attrs.content);
    state.ensureNewLine();
    state.write('---');
    state.closeBlock();
  },

  // Footnotes
  footnoteRef(state, node) {
    state.write(`[^${node.attrs.label || node.attrs.id}]`);
  },

  footnoteBlock(state, node) {
    const id = node.attrs.id;
    state.write(`[^${id}]: `);
    const inner = new MarkdownSerializerState();
    inner.renderContent(node);
    state.write(inner.getOutput().trim());
    state.closeBlock();
  },
};

// --- Mark Wrappers ---

function getMarkWrapper(mark: Mark): { open: string; close: string } | null {
  switch (mark.type.name) {
    case 'bold':
    case 'strong':
      return { open: '**', close: '**' };
    case 'italic':
    case 'em':
      return { open: '_', close: '_' };
    case 'strike':
      return { open: '~~', close: '~~' };
    case 'code':
      return { open: '`', close: '`' };
    case 'underline':
      return { open: '<u>', close: '</u>' };
    case 'link': {
      const href = mark.attrs.href as string;
      const title = mark.attrs.title as string;
      return {
        open: '[',
        close: `](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`,
      };
    }
    case 'highlight': {
      const color = mark.attrs.color as string | null;
      if (color) {
        return { open: `<mark data-color="${color}" style="background-color:${color};color:inherit">`, close: '</mark>' };
      }
      return { open: '<mark>', close: '</mark>' };
    }
    case 'markovHighlight':
      return {
        open: `<span data-markov="hl" data-comment-id="${mark.attrs.commentId}">`,
        close: `</span>`,
      };
    case 'markovInsert':
      return {
        open: `<span data-markov="ins" data-change-id="${mark.attrs.changeId}" data-author="${mark.attrs.author}" data-date="${mark.attrs.date}">`,
        close: `</span>`,
      };
    case 'markovDelete':
      return {
        open: `<span data-markov="del" data-change-id="${mark.attrs.changeId}" data-author="${mark.attrs.author}" data-date="${mark.attrs.date}">`,
        close: `</span>`,
      };
    default:
      return null;
  }
}

function getInlineUnitsWithMarkdownSafeMarks(node: Node): InlineUnit[] {
  const units: InlineUnit[] = [];
  let textUnits: TextUnit[] = [];

  const flushTextUnits = () => {
    if (textUnits.length > 0) {
      units.push(...normalizeFlankingSensitiveMarks(textUnits));
      textUnits = [];
    }
  };

  node.forEach((child) => {
    if (child.isText) {
      textUnits.push({ kind: 'text', text: child.text || '', marks: [...child.marks] });
    } else {
      flushTextUnits();
      units.push({ kind: 'leaf', node: child });
    }
  });

  flushTextUnits();
  return units;
}

function normalizeFlankingSensitiveMarks(units: TextUnit[]): TextUnit[] {
  const chars = units.flatMap((unit) =>
    Array.from(unit.text).map((text) => ({
      text,
      marks: [...unit.marks],
    })),
  );
  const sensitiveMarks: Mark[] = [];

  for (const char of chars) {
    for (const mark of char.marks) {
      if (isFlankingSensitiveMark(mark) && !sensitiveMarks.some((m) => marksEqual(m, mark))) {
        sensitiveMarks.push(mark);
      }
    }
  }

  for (const mark of sensitiveMarks) {
    let index = 0;
    while (index < chars.length) {
      if (!chars[index].marks.some((m) => marksEqual(m, mark))) {
        index++;
        continue;
      }

      const start = index;
      while (index < chars.length && chars[index].marks.some((m) => marksEqual(m, mark))) {
        index++;
      }
      const end = index;

      let firstContent = start;
      while (firstContent < end && /\s/.test(chars[firstContent].text)) {
        removeMark(chars[firstContent].marks, mark);
        firstContent++;
      }

      let lastContent = end - 1;
      while (lastContent >= firstContent && /\s/.test(chars[lastContent].text)) {
        removeMark(chars[lastContent].marks, mark);
        lastContent--;
      }
    }
  }

  const normalized: TextUnit[] = [];
  for (const char of chars) {
    const last = normalized[normalized.length - 1];
    if (last && markSetsEqual(last.marks, char.marks)) {
      last.text += char.text;
    } else {
      normalized.push({ kind: 'text', text: char.text, marks: char.marks });
    }
  }
  return normalized;
}

function removeMark(marks: Mark[], mark: Mark) {
  const index = marks.findIndex((m) => marksEqual(m, mark));
  if (index !== -1) {
    marks.splice(index, 1);
  }
}

// --- Escaping ---

function escapeMarkdown(text: string, marks: readonly Mark[]): string {
  // Don't escape inside code marks
  if (marks.some((m) => m.type.name === 'code')) {
    return text;
  }
  // Only escape characters that could trigger markdown formatting in inline context
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_~`])/g, '\\$1')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}
