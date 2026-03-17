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
                  // Determine whether the deleted range contains tracked marks and/or
                  // block-level nodes (tables, code blocks, etc.).
                  let hasTrackedNodes = false;
                  oldState.doc.nodesBetween(oldStart, oldEnd, (node) => {
                    if (!node.isText) return true;
                    if (node.marks.some((m) => m.type.name === 'markovInsert' || m.type.name === 'markovDelete')) {
                      hasTrackedNodes = true;
                      return false;
                    }
                  });

                  if (hasTrackedNodes) {
                    // Flag so any paired restoration insertion in this transaction
                    // (i.e. undo of a tracked deletion) is not marked as a new edit.
                    skippedTrackedDeletion = true;

                    // Mixed range: still track the untracked text portions
                    let untrackedText = '';
                    oldState.doc.nodesBetween(oldStart, oldEnd, (node, pos) => {
                      if (!node.isText || !node.text) return true;
                      if (!node.marks.some((m) => m.type.name === 'markovInsert' || m.type.name === 'markovDelete')) {
                        const s = Math.max(pos, oldStart);
                        const e = Math.min(pos + node.nodeSize, oldEnd);
                        untrackedText += node.text.slice(s - pos, e - pos);
                      }
                    });
                    if (untrackedText) {
                      const changeId = nanoid(8);
                      const deleteMark = newState.schema.marks.markovDelete.create({ changeId, author, date });
                      tr.insert(adjNewEnd, newState.schema.text(untrackedText, [deleteMark]));
                      insertionOffset += untrackedText.length;
                      hasChanges = true;
                    }
                  } else {
                    // Pure untracked deletion — check for block-level content
                    const slice = oldState.doc.slice(oldStart, oldEnd);
                    let hasBlocks = false;
                    slice.content.forEach((node) => { if (node.isBlock) hasBlocks = true; });

                    if (hasBlocks) {
                      const changeId = nanoid(8);
                      const deleteMark = newState.schema.marks.markovDelete.create({ changeId, author, date });

                      if (slice.openStart === 0 && slice.openEnd === 0) {
                        // Clean block deletion (selection at exact block boundaries):
                        // re-insert original nodes and mark all inline text within.
                        tr.insert(adjNewEnd, slice.content);
                        tr.addMark(adjNewEnd, adjNewEnd + slice.content.size, deleteMark);
                        insertionOffset += slice.content.size;
                        hasChanges = true;
                      } else {
                        // Selection crossed a paragraph boundary (openStart/openEnd > 0).
                        // Inserting slice.content at a mid-paragraph position is invalid.
                        // Split into three parts:
                        //   1. Inline ghost text for the partial first paragraph
                        //   2. Complete block nodes (table, code block, etc.) re-inserted
                        //      just after the merged paragraph
                        //   3. Ghost paragraph for the partial last paragraph
                        const $fromOld = oldState.doc.resolve(oldStart);
                        const $toOld = oldState.doc.resolve(oldEnd);

                        // 1. Inline text from partial first paragraph (selection start → para end)
                        const firstInlineText = slice.openStart > 0 && $fromOld.depth >= 1
                          ? oldState.doc.textBetween(oldStart, Math.min($fromOld.end(1), oldEnd), '\n')
                          : '';

                        // Range of complete blocks between the partial first/last paragraphs
                        const blocksStart = slice.openStart > 0 && $fromOld.depth >= 1
                          ? $fromOld.after(1) : oldStart;
                        const blocksEnd = slice.openEnd > 0 && $toOld.depth >= 1
                          ? $toOld.before(1) : oldEnd;

                        // 1. Insert inline ghost text for the partial first paragraph
                        if (firstInlineText) {
                          tr.insert(adjNewEnd, newState.schema.text(firstInlineText, [deleteMark]));
                          insertionOffset += firstInlineText.length;
                          hasChanges = true;
                        }

                        // Insertion point for block-level ghost content:
                        // - openStart > 0: we are inside a merged paragraph → go after it
                        // - openStart = 0: newEnd is already at a block boundary
                        const insertBlocksAt = slice.openStart > 0
                          ? newState.doc.resolve(newEnd).after(1) + insertionOffset
                          : newEnd + insertionOffset;

                        // 2. Re-insert complete block nodes
                        let insertedBlocksSize = 0;
                        if (blocksStart < blocksEnd) {
                          const blockSlice = oldState.doc.slice(blocksStart, blocksEnd);
                          if (blockSlice.openStart === 0 && blockSlice.openEnd === 0 && blockSlice.content.size > 0) {
                            tr.insert(insertBlocksAt, blockSlice.content);
                            tr.addMark(insertBlocksAt, insertBlocksAt + blockSlice.content.size, deleteMark);
                            insertedBlocksSize = blockSlice.content.size;
                            insertionOffset += insertedBlocksSize;
                            hasChanges = true;
                          }
                        }

                        // 3. Re-insert partial last paragraph as a ghost paragraph node
                        if (slice.openEnd > 0 && $toOld.depth >= 1) {
                          const lastInlineText = oldState.doc.textBetween($toOld.start(1), oldEnd, '\n');
                          if (lastInlineText) {
                            const textNode = newState.schema.text(lastInlineText, [deleteMark]);
                            const paraNode = newState.schema.nodes.paragraph.create({}, textNode);
                            const insertLastAt = insertBlocksAt + insertedBlocksSize;
                            tr.insert(insertLastAt, paraNode);
                            insertionOffset += paraNode.nodeSize;
                            hasChanges = true;
                          }
                        }
                      }
                    } else {
                      // Pure inline text deletion
                      const deletedText = oldState.doc.textBetween(oldStart, oldEnd, '\n');
                      if (deletedText) {
                        const changeId = nanoid(8);
                        const deleteMark = newState.schema.marks.markovDelete.create({ changeId, author, date });
                        tr.insert(adjNewEnd, newState.schema.text(deletedText, [deleteMark]));
                        insertionOffset += deletedText.length;
                        hasChanges = true;
                      }
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
