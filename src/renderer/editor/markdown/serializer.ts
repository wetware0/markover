import type { Node, Mark } from '@tiptap/pm/model';

/**
 * Serialize a ProseMirror document to markdown.
 */
export function prosemirrorToMarkdown(doc: Node): string {
  const state = new MarkdownSerializerState();
  state.renderContent(doc);
  return state.getOutput();
}

class MarkdownSerializerState {
  private output = '';
  private closed = false;
  private inTightList = false;

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
      // Fallback: render as inline content
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

  renderInlineContent(node: Node) {
    node.forEach((child) => {
      this.renderInline(child);
    });
  }

  private renderMarkedText(node: Node) {
    const text = node.text || '';
    const marks = node.marks || [];

    let openMarks = '';
    let closeMarks = '';

    for (const mark of marks) {
      const wrapper = getMarkWrapper(mark);
      if (wrapper) {
        openMarks += wrapper.open;
        closeMarks = wrapper.close + closeMarks;
      }
    }

    this.write(openMarks + escapeMarkdown(text, marks) + closeMarks);
  }

  renderList(node: Node, prefix: (index: number) => string) {
    const prevTight = this.inTightList;
    this.inTightList = true;

    node.forEach((child, _offset, index) => {
      this.write(prefix(index));
      this.renderListItem(child);
    });

    this.inTightList = prevTight;
    if (!this.output.endsWith('\n\n')) {
      this.ensureNewLine();
      this.write('\n');
    }
  }

  private renderListItem(node: Node) {
    // Render paragraph content inline (no blank line between list items)
    let first = true;
    node.forEach((child) => {
      if (child.type.name === 'paragraph') {
        if (!first) {
          this.ensureNewLine();
          this.write('  '); // continuation indent
        }
        this.renderInlineContent(child);
        this.ensureNewLine();
        first = false;
      } else {
        // Nested lists, etc.
        if (!first) {
          this.write('  ');
        }
        this.renderNode(child, node, 0);
        first = false;
      }
    });
  }
}

// --- Node Handlers ---

type NodeHandler = (state: MarkdownSerializerState, node: Node, parent: Node, index: number) => void;

const nodeHandlers: Record<string, NodeHandler> = {
  doc(state, node) {
    state.renderContent(node);
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

  listItem(state, _node) {
    // Handled by renderList
  },

  taskList(state, node) {
    node.forEach((child) => {
      const checked = child.attrs.checked as boolean;
      state.write(checked ? '- [x] ' : '- [ ] ');
      // Render task item children
      child.forEach((grandchild) => {
        if (grandchild.type.name === 'paragraph') {
          state.renderInlineContent(grandchild);
          state.ensureNewLine();
        } else {
          state.renderNode(grandchild, child, 0);
        }
      });
    });
    state.closeBlock();
  },

  taskItem(state, _node) {
    // Handled by taskList
  },

  codeBlock(state, node) {
    const language = (node.attrs.language as string) || '';
    state.write('```' + language + '\n');
    state.write(node.textContent);
    state.ensureNewLine();
    state.write('```');
    state.closeBlock();
  },

  blockquote(state, node) {
    const inner = new MarkdownSerializerState();
    inner.renderContent(node);
    const lines = inner.getOutput().replace(/\n+$/, '').split('\n');
    for (const line of lines) {
      state.write('> ' + line);
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
    state.write(`![${alt}](${src}${title ? ` "${title}"` : ''})`);
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

    // Separator row
    state.write('| ');
    headerRow.forEach((_cell, _offset, i) => {
      if (i > 0) state.write(' | ');
      state.write('---');
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
      return { open: '*', close: '*' };
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
        close: `](${href}${title ? ` "${title}"` : ''})`,
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
