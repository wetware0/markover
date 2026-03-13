import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

export const KatexBlock = Node.create({
  name: 'katexBlock',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      math: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-katex-block]',
        getAttrs: (el) => ({
          math: (el as HTMLElement).getAttribute('data-katex-block'),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const math = node.attrs.math as string;
    let rendered: string;
    try {
      rendered = katex.renderToString(math, { throwOnError: false, displayMode: true });
    } catch {
      rendered = math;
    }

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-katex-block': math,
        class: 'katex-block',
        contenteditable: 'false',
      }),
      ['div', { innerHTML: rendered }],
    ];
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const dom = document.createElement('div');
      dom.setAttribute('data-katex-block', node.attrs.math);
      dom.classList.add('katex-block');
      dom.contentEditable = 'false';
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (typeof value === 'string') dom.setAttribute(key, value);
      });

      try {
        katex.render(node.attrs.math, dom, { throwOnError: false, displayMode: true });
      } catch {
        dom.textContent = node.attrs.math;
      }

      return { dom };
    };
  },
});
