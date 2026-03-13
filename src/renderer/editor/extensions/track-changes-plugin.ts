import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { nanoid } from 'nanoid';

export const trackChangesPluginKey = new PluginKey('trackChanges');

interface TrackChangesPluginState {
  enabled: boolean;
  author: string;
}

export const TrackChangesPlugin = Extension.create({
  name: 'trackChangesPlugin',

  addStorage() {
    return {
      enabled: false,
      author: 'User',
    };
  },

  addProseMirrorPlugins() {
    const extension = this;

    return [
      new Plugin({
        key: trackChangesPluginKey,

        state: {
          init(): TrackChangesPluginState {
            return { enabled: false, author: 'User' };
          },
          apply(): TrackChangesPluginState {
            return {
              enabled: extension.storage.enabled,
              author: extension.storage.author,
            };
          },
        },

        appendTransaction(transactions, oldState, newState) {
          if (!extension.storage.enabled) return null;

          // Only intercept user-initiated transactions with doc changes
          const userTx = transactions.find(
            (tr) => tr.docChanged && !tr.getMeta('trackChangesProcessed'),
          );
          if (!userTx) return null;

          const author = extension.storage.author;
          const date = new Date().toISOString().split('T')[0];
          const tr = newState.tr;
          tr.setMeta('trackChangesProcessed', true);

          let hasChanges = false;
          let insertionOffset = 0;

          userTx.steps.forEach((step) => {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              const adjNewStart = newStart + insertionOffset;
              const adjNewEnd = newEnd + insertionOffset;

              // Text was inserted (new content in the diff range)
              if (newEnd > newStart) {
                const changeId = nanoid(8);
                const insertMark = newState.schema.marks.markovInsert.create({
                  changeId,
                  author,
                  date,
                });
                tr.addMark(adjNewStart, adjNewEnd, insertMark);
                hasChanges = true;
              }

              // Text was deleted (old content was removed)
              if (oldEnd > oldStart) {
                try {
                  const deletedText = oldState.doc.textBetween(oldStart, oldEnd, '\n');
                  if (deletedText) {
                    const changeId = nanoid(8);
                    const deleteMark = newState.schema.marks.markovDelete.create({
                      changeId,
                      author,
                      date,
                    });
                    const textNode = newState.schema.text(deletedText, [deleteMark]);
                    tr.insert(adjNewEnd, textNode);
                    insertionOffset += deletedText.length;
                    hasChanges = true;
                  }
                } catch {
                  // Skip if can't read deleted text (e.g., structural changes)
                }
              }
            });
          });

          return hasChanges ? tr : null;
        },
      }),
    ];
  },
});
