import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    markovHighlight: {
      setMarkovHighlight: (attrs: { commentId: string }) => ReturnType;
      unsetMarkovHighlight: (commentId: string) => ReturnType;
    };
  }
}

export const MarkovHighlight = Mark.create({
  name: 'markovHighlight',
  inclusive: false,
  excludes: '',

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-comment-id'),
        renderHTML: (attrs) => ({ 'data-comment-id': attrs.commentId }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'markover-highlight' }),
      0,
    ];
  },

  addCommands() {
    return {
      setMarkovHighlight:
        (attrs) =>
        ({ commands }) =>
          commands.setMark(this.name, attrs),
      unsetMarkovHighlight:
        (commentId: string) =>
        ({ tr, state }) => {
          const { doc } = state;
          doc.descendants((node, pos) => {
            if (!node.isText) return;
            const mark = node.marks.find(
              (m) => m.type.name === 'markovHighlight' && m.attrs.commentId === commentId,
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
