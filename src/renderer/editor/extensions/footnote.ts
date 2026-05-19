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
          // markdown-it-footnote wraps the number in brackets: "[1]"
          // Strip them so the serializer can write [^1] not [^[1]]
          const raw = anchor?.textContent || id;
          const label = raw.replace(/^\[|\]$/g, '');
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
      id: {
        default: '',
        // markdown-it-footnote emits id="fn1" on the <li>. The serializer
        // wants just the bare label (e.g. "1") so the saved markdown reads
        // `[^1]: …`, not `[^fn1]: …`. Strip the prefix here so the attribute
        // is consistently the bare id whichever path TipTap takes.
        parseHTML: (el) =>
          (el as HTMLElement).getAttribute('id')?.replace(/^fn/, '') || '',
      },
    };
  },

  parseHTML() {
    return [
      {
        // Higher than the default `li` rule (priority 50) so the FootnoteBlock
        // wins over ListItem when both can match — otherwise an orphan
        // <li class="footnote-item"> gets adopted into a bullet list.
        tag: 'li.footnote-item',
        priority: 60,
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
