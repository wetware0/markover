import TaskList from '@tiptap/extension-task-list';

/**
 * TaskList that preserves whether the source markdown list was "loose"
 * (blank lines between items). markdown-it knows this at parse time but the
 * node tree otherwise loses it, so the serializer would have to guess.
 */
export const MarkoverTaskList = TaskList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      loose: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-loose') === 'true',
        renderHTML: (attrs: { loose?: boolean }) => (attrs.loose ? { 'data-loose': 'true' } : {}),
      },
    };
  },
});
