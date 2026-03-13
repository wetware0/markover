import { Node, mergeAttributes } from '@tiptap/core';

export const FrontMatter = Node.create({
  name: 'frontMatter',
  group: 'block',
  atom: true,
  draggable: false,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      content: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-front-matter]',
        getAttrs: (el) => ({
          content: (el as HTMLElement).getAttribute('data-front-matter'),
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-front-matter': node.attrs.content,
        class: 'front-matter',
        contenteditable: 'false',
      }),
      ['pre', {}, node.attrs.content],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('div');
      dom.classList.add('front-matter');
      dom.contentEditable = 'false';

      const pre = document.createElement('pre');
      pre.classList.add('front-matter-content');
      pre.textContent = node.attrs.content;

      const label = document.createElement('div');
      label.classList.add('front-matter-label');
      label.textContent = 'YAML Front Matter';

      dom.appendChild(label);
      dom.appendChild(pre);

      return { dom };
    };
  },
});
