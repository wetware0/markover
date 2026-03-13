import { Node, mergeAttributes } from '@tiptap/core';

export const FootnoteRef = Node.create({
  name: 'footnoteRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: '' },
      label: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'sup.footnote-ref',
        getAttrs: (el) => {
          const anchor = (el as HTMLElement).querySelector('a');
          const id = anchor?.getAttribute('href')?.replace('#fn', '') || '';
          const label = anchor?.textContent || id;
          return { id, label };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'sup',
      mergeAttributes(HTMLAttributes, { class: 'footnote-ref' }),
      [
        'a',
        { href: `#fn${node.attrs.id}`, id: `fnref${node.attrs.id}` },
        node.attrs.label || node.attrs.id,
      ],
    ];
  },
});

export const FootnoteBlock = Node.create({
  name: 'footnoteBlock',
  group: 'block',
  content: 'block*',

  addAttributes() {
    return {
      id: { default: '' },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'li.footnote-item',
        getAttrs: (el) => ({
          id: (el as HTMLElement).getAttribute('id')?.replace('fn', '') || '',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'li',
      mergeAttributes(HTMLAttributes, {
        class: 'footnote-item',
        id: `fn${node.attrs.id}`,
      }),
      0,
    ];
  },
});
