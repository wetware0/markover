import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
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
          apply(_tr, value): TrackChangesPluginState {
            return {
              enabled: extension.storage.enabled,
              author: extension.storage.author,
            };
          },
        },

        appendTransaction(transactions, _oldState, newState) {
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

          // Walk through the steps to find insertions and deletions
          userTx.steps.forEach((step, index) => {
            const stepMap = step.getMap();
            stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
              const changeId = nanoid(8);

              // Text was inserted
              if (newEnd > newStart && oldEnd === oldStart) {
                const insertMark = newState.schema.marks.markovInsert.create({
                  changeId,
                  author,
                  date,
                });
                tr.addMark(newStart, newEnd, insertMark);
                hasChanges = true;
              }

              // Text was deleted — we can't easily re-insert deleted text in appendTransaction
              // Instead, we handle deletions by converting them to delete marks before the deletion happens
              // For now, just mark any replacement as insert (the old text is already gone)
              if (newEnd > newStart && oldEnd > oldStart) {
                const insertMark = newState.schema.marks.markovInsert.create({
                  changeId,
                  author,
                  date,
                });
                tr.addMark(newStart, newEnd, insertMark);
                hasChanges = true;
              }
            });
          });

          return hasChanges ? tr : null;
        },
      }),
    ];
  },
});
