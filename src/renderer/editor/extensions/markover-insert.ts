import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    markovInsert: {
      setMarkovInsert: (attrs: { changeId: string; author: string; date: string }) => ReturnType;
      unsetMarkovInsert: (changeId: string) => ReturnType;
    };
  }
}

export const MarkovInsert = Mark.create({
  name: 'markovInsert',
  inclusive: false,
  excludes: '',
  priority: 110,

  addAttributes() {
    return {
      changeId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-change-id'),
        renderHTML: (attrs) => ({ 'data-markov': 'ins', 'data-change-id': attrs.changeId }),
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
      { tag: 'span[data-markov="ins"]' },
      { tag: 'ins[data-change-id]' },  // backwards compat
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'markover-insert' }), 0];
  },

  addCommands() {
    return {
      setMarkovInsert:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetMarkovInsert:
        (changeId: string) =>
        ({ tr, state }) => {
          const { doc } = state;
          doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type.name === 'markovInsert' && m.attrs.changeId === changeId,
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
