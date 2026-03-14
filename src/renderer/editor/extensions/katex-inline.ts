import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export const KatexInline = Node.create({
  name: 'katexInline',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      math: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-katex-inline]',
        getAttrs: (el) => ({
          math: (el as HTMLElement).getAttribute('data-katex-inline'),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const math = node.attrs.math as string;
    let rendered: string;
    try {
      rendered = katex.renderToString(math, { throwOnError: false, displayMode: false });
    } catch {
      rendered = math;
    }

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-katex-inline': math,
        class: 'katex-inline',
        contenteditable: 'false',
      }),
      ['span', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes, getPos }) => {
      const dom = document.createElement('span');
      dom.setAttribute('data-katex-inline', node.attrs.math);
      dom.classList.add('katex-inline', 'markov-editable-node');
      dom.contentEditable = 'false';
      dom.title = 'Double-click to edit';
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (typeof value === 'string') dom.setAttribute(key, value);
      });

      try {
        katex.render(node.attrs.math, dom, { throwOnError: false, displayMode: false });
      } catch {
        dom.textContent = node.attrs.math;
      }

      dom.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('markover:edit-node', {
          detail: { nodeType: 'katexInline', math: node.attrs.math, getPos },
        }));
      });

      return { dom };
    };
  },
});
