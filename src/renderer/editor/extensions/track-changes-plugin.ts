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
      // Grouping state: reuse the same changeId for consecutive characters
      // typed at adjacent positions, so "hello" becomes one tracked change
      // rather than five separate ones.
      currentInsertId: null as string | null,
      lastInsertEnd: null as number | null,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    const extensionName = this.name;

    return [
      new Plugin({
        key: trackChangesPluginKey,

        state: {
          init(): TrackChangesPluginState {
            return { enabled: false, author: 'User' };
          },
          apply(): TrackChangesPluginState {
            const s = editor.storage[extensionName] as TrackChangesPluginState;
            return { enabled: s.enabled, author: s.author };
          },
        },

        appendTransaction(transactions, oldState, newState) {
          const storage = editor.storage[extensionName] as TrackChangesPluginState & {
            currentInsertId: string | null;
            lastInsertEnd: number | null;
          };
          if (!storage.enabled) return null;

          const userTx = transactions.find(
            (tr) => tr.docChanged && !tr.getMeta('trackChangesProcessed'),
          );
          if (!userTx) return null;

          const author = storage.author;
          const date = new Date().toISOString().split('T')[0];
          const tr = newState.tr;
          tr.setMeta('trackChangesProcessed', true);

          let hasChanges = false;
          let insertionOffset = 0;

          userTx.steps.forEach((step) => {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              const adjNewStart = newStart + insertionOffset;
              const adjNewEnd = newEnd + insertionOffset;

              // Text was inserted — group consecutive keystrokes into one change
              if (newEnd > newStart) {
                let changeId: string;
                if (storage.currentInsertId && storage.lastInsertEnd === newStart) {
                  // Continuation of an existing insert run — reuse the same id
                  changeId = storage.currentInsertId;
                } else {
                  // New insert run (cursor moved, deletion intervened, etc.)
                  changeId = nanoid(8);
                }
                storage.currentInsertId = changeId;
                storage.lastInsertEnd = newEnd;

                const insertMark = newState.schema.marks.markovInsert.create({
                  changeId,
                  author,
                  date,
                });
                tr.addMark(adjNewStart, adjNewEnd, insertMark);
                hasChanges = true;
              }

              // Text was deleted — break the insert grouping run
              if (oldEnd > oldStart) {
                storage.currentInsertId = null;
                storage.lastInsertEnd = null;
                try {
                  const deletedText = oldState.doc.textBetween(oldStart, oldEnd, '\n');
                  if (deletedText) {
                    // If the deleted range already contains tracked change marks, skip.
                    // This handles undo of tracked insertions (Ctrl-Z re-deleting tracked
                    // text should not create a spurious markovDelete mark) and also
                    // cancels out deletion of already-tracked insertions.
                    let hasTrackedMark = false;
                    oldState.doc.nodesBetween(oldStart, oldEnd, (node) => {
                      if (
                        node.isText &&
                        node.marks.some(
                          (m) =>
                            m.type.name === 'markovInsert' || m.type.name === 'markovDelete',
                        )
                      ) {
                        hasTrackedMark = true;
                        return false;
                      }
                    });
                    if (!hasTrackedMark) {
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
                  }
                } catch {
                  // Skip structural changes (e.g. node splits)
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
