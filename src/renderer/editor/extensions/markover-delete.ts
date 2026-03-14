import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    markovDelete: {
      setMarkovDelete: (attrs: { changeId: string; author: string; date: string }) => ReturnType;
      unsetMarkovDelete: (changeId: string) => ReturnType;
    };
  }
}

export const MarkovDelete = Mark.create({
  name: 'markovDelete',
  inclusive: false,
  excludes: '',
  priority: 110,

  addAttributes() {
    return {
      changeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-change-id'),
        renderHTML: (attrs) => ({ 'data-markov': 'del', 'data-change-id': attrs.changeId }),
      },
      author: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-author'),
        renderHTML: (attrs) => ({ 'data-author': attrs.author }),
      },
      date: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-date'),
        renderHTML: (attrs) => ({ 'data-date': attrs.date }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-markov="del"]' },
      { tag: 'del[data-change-id]' },  // backwards compat
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'markover-delete' }), 0];
  },

  addCommands() {
    return {
      setMarkovDelete:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetMarkovDelete:
        (changeId: string) =>
        ({ tr, state }) => {
          const { doc } = state;
          doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type.name === 'markovDelete' && m.attrs.changeId === changeId,
            );
            if (mark) {
              tr.removeMark(pos, pos + node.nodeSize, mark);
            }
          });
          return true;
        },
    };
  },
});
