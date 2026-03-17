// src/renderer/editor/extensions/find-replace-extension.ts
import { Extension } from '@tiptap/core';
import { nanoid } from 'nanoid';
import { createFindReplacePlugin, findReplacePluginKey, detectScope, getPluginState } from './find-replace-plugin';
import { useTrackChangesStore } from '../../collaboration/track-changes/track-changes-store';
import type { SearchOptions } from '../../store/find-replace-store';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    findReplace: {
      setSearchQuery: (query: string, options: SearchOptions) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      replaceMatch: (replacement: string) => ReturnType;
      replaceAll: (replacement: string) => ReturnType;
      clearSearch: () => ReturnType;
      getMatchCount: () => ReturnType;
    };
  }
}

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [createFindReplacePlugin()];
  },

  addCommands() {
    return {
      setSearchQuery:
        (query: string, options: SearchOptions) =>
        ({ state, dispatch }) => {
          const scope = detectScope(state);
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setQuery', query, options, scope }));
          }
          return true;
        },

      findNext:
        () =>
        ({ state, dispatch, view }) => {
          const ps = getPluginState(state);
          if (!ps) return false;
          const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
          if (!list.length) return false;

          let newIndex = ps.currentIndex + 1;
          if (newIndex >= list.length) {
            if (!ps.options.wrap) return false;
            newIndex = 0;
          }

          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setIndex', index: newIndex }));
            setTimeout(() => {
              const el = view?.dom.querySelector('.find-match-current');
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 0);
          }
          return true;
        },

      findPrev:
        () =>
        ({ state, dispatch, view }) => {
          const ps = getPluginState(state);
          if (!ps) return false;
          const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
          if (!list.length) return false;

          let newIndex = ps.currentIndex - 1;
          if (newIndex < 0) {
            if (!ps.options.wrap) return false;
            newIndex = list.length - 1;
          }

          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setIndex', index: newIndex }));
            setTimeout(() => {
              const el = view?.dom.querySelector('.find-match-current');
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 0);
          }
          return true;
        },

      replaceMatch:
        (replacement: string) =>
        ({ state, dispatch, editor }) => {
          const ps = getPluginState(state);
          if (!ps || ps.regexError) return false;

          const trackChangesOn = useTrackChangesStore.getState().enabled;

          if (ps.scope === 'text') {
            if (!ps.matches.length) return false;
            const match = ps.matches[ps.currentIndex];
            if (!match) return false;
            const schema = state.schema;
            const { tr } = state;

            if (trackChangesOn) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const author = (editor.storage.trackChangesPlugin as any)?.author ?? 'User';
              const date = new Date().toISOString().split('T')[0];
              const insertMark = schema.marks.markovInsert?.create({ changeId: nanoid(8), author, date });
              const deleteMark = schema.marks.markovDelete?.create({ changeId: nanoid(8), author, date });
              tr.setMeta('trackChangesProcessed', true);
              if (replacement && insertMark) {
                tr.insert(match.from, schema.text(replacement, [insertMark]));
              }
              if (deleteMark) {
                const delFrom = match.from + replacement.length;
                const delTo = match.to + replacement.length;
                tr.addMark(delFrom, delTo, deleteMark);
              }
            } else {
              if (replacement) {
                tr.replaceWith(match.from, match.to, schema.text(replacement));
              } else {
                tr.delete(match.from, match.to);
              }
            }

            if (dispatch) dispatch(tr);
            return true;
          }

          // Atom node replace
          if (!ps.atomMatches.length) return false;
          const atomMatch = ps.atomMatches[ps.currentIndex];
          if (!atomMatch) return false;
          const node = state.doc.nodeAt(atomMatch.nodePos);
          if (!node) return false;
          const attr = ps.scope === 'mermaid' ? 'code' : 'math';

          let newValue: string;
          try {
            const flags = ps.options.matchCase ? 'g' : 'gi';
            const pat = ps.options.regex
              ? new RegExp(ps.query, flags)
              : new RegExp(
                  (ps.options.wholeWord ? '\\b' : '') +
                    ps.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    (ps.options.wholeWord ? '\\b' : ''),
                  flags,
                );
            newValue = (node.attrs[attr] as string).replace(pat, replacement);
          } catch {
            return false;
          }

          if (dispatch) {
            const { tr } = state;
            tr.setNodeMarkup(atomMatch.nodePos, undefined, { ...node.attrs, [attr]: newValue });
            dispatch(tr);
          }
          return true;
        },

      replaceAll:
        (replacement: string) =>
        ({ state, dispatch, editor }) => {
          const ps = getPluginState(state);
          if (!ps || ps.regexError) return false;

          const trackChangesOn = useTrackChangesStore.getState().enabled;
          const schema = state.schema;
          const { tr } = state;

          if (ps.scope === 'text') {
            if (!ps.matches.length) return false;
            // Process in reverse order to avoid position drift
            const sorted = [...ps.matches].sort((a, b) => b.from - a.from);

            if (trackChangesOn) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const author = (editor.storage.trackChangesPlugin as any)?.author ?? 'User';
              const date = new Date().toISOString().split('T')[0];
              tr.setMeta('trackChangesProcessed', true);
              for (const m of sorted) {
                const insertMark = schema.marks.markovInsert?.create({ changeId: nanoid(8), author, date });
                const deleteMark = schema.marks.markovDelete?.create({ changeId: nanoid(8), author, date });
                if (replacement && insertMark) {
                  tr.insert(m.from, schema.text(replacement, [insertMark]));
                }
                if (deleteMark) {
                  tr.addMark(m.from + replacement.length, m.to + replacement.length, deleteMark);
                }
              }
            } else {
              for (const m of sorted) {
                if (replacement) {
                  tr.replaceWith(m.from, m.to, schema.text(replacement));
                } else {
                  tr.delete(m.from, m.to);
                }
              }
            }

            if (dispatch) dispatch(tr);
            return true;
          }

          // Atom nodes
          if (!ps.atomMatches.length) return false;
          let pat: RegExp;
          try {
            const flags = ps.options.matchCase ? 'g' : 'gi';
            pat = ps.options.regex
              ? new RegExp(ps.query, flags)
              : new RegExp(
                  (ps.options.wholeWord ? '\\b' : '') +
                    ps.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    (ps.options.wholeWord ? '\\b' : ''),
                  flags,
                );
          } catch {
            return false;
          }

          const attr = ps.scope === 'mermaid' ? 'code' : 'math';
          const sorted2 = [...ps.atomMatches].sort((a, b) => b.nodePos - a.nodePos);
          for (const am of sorted2) {
            const node = state.doc.nodeAt(am.nodePos);
            if (!node) continue;
            const newValue = (node.attrs[attr] as string).replace(pat, replacement);
            tr.setNodeMarkup(am.nodePos, undefined, { ...node.attrs, [attr]: newValue });
          }
          if (dispatch) dispatch(tr);
          return true;
        },

      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'clear' }));
          }
          return true;
        },

      getMatchCount: () => ({ editor }) => {
        const ps = getPluginState(editor.state);
        if (!ps) return { count: 0, index: 0, scope: 'text' as const, regexError: null };
        const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
        return { count: list.length, index: ps.currentIndex, scope: ps.scope, regexError: ps.regexError };
      },
    };
  },
});
