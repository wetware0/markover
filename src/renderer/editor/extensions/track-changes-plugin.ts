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
          // When a step in this transaction skips a deletion of tracked text (e.g. the
          // inversion of a markovDelete re-insertion during undo), any subsequent
          // insertion in the same transaction is the undo restoring the original text —
          // not a new user edit — and must not receive a markovInsert mark.
          let skippedTrackedDeletion = false;

          userTx.steps.forEach((step) => {
            step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
              const adjNewStart = newStart + insertionOffset;
              const adjNewEnd = newEnd + insertionOffset;

              // Text was inserted — group consecutive keystrokes into one change.
              // Skip if we already skipped a tracked deletion in this transaction:
              // that means this insertion is the undo restoring the original text.
              if (newEnd > newStart && !skippedTrackedDeletion) {
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
                  // Classify the deleted content: tracked nodes (markovInsert/Delete)
                  // and untracked text. For undo safety, set skippedTrackedDeletion if
                  // any tracked marks are present. For mixed ranges, still track the
                  // untracked portions so they aren't silently lost.
                  let hasTrackedNodes = false;
                  let hasUntrackedNodes = false;
                  oldState.doc.nodesBetween(oldStart, oldEnd, (node) => {
                    if (!node.isText) return true;
                    if (node.marks.some((m) => m.type.name === 'markovInsert' || m.type.name === 'markovDelete')) {
                      hasTrackedNodes = true;
                    } else if (node.text) {
                      hasUntrackedNodes = true;
                    }
                  });

                  if (hasTrackedNodes) {
                    // Flag so any paired restoration insertion in this transaction
                    // (i.e. undo of a tracked deletion) is not marked as a new edit.
                    skippedTrackedDeletion = true;
                  }

                  if (hasUntrackedNodes) {
                    let textToTrack: string;
                    if (!hasTrackedNodes) {
                      // Pure untracked deletion — use textBetween to get paragraph seps
                      textToTrack = oldState.doc.textBetween(oldStart, oldEnd, '\n');
                    } else {
                      // Mixed range — collect only the untracked text segments
                      let untrackedText = '';
                      oldState.doc.nodesBetween(oldStart, oldEnd, (node, pos) => {
                        if (!node.isText || !node.text) return true;
                        if (!node.marks.some((m) => m.type.name === 'markovInsert' || m.type.name === 'markovDelete')) {
                          const s = Math.max(pos, oldStart);
                          const e = Math.min(pos + node.nodeSize, oldEnd);
                          untrackedText += node.text.slice(s - pos, e - pos);
                        }
                      });
                      textToTrack = untrackedText;
                    }

                    if (textToTrack) {
                      const changeId = nanoid(8);
                      const deleteMark = newState.schema.marks.markovDelete.create({
                        changeId,
                        author,
                        date,
                      });
                      const textNode = newState.schema.text(textToTrack, [deleteMark]);
                      tr.insert(adjNewEnd, textNode);
                      insertionOffset += textToTrack.length;
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
