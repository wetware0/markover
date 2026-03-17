// src/renderer/ui/find-replace/FindReplaceDialog.tsx
import React, { useEffect, useRef, useCallback } from 'react';
import { X, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useFindReplaceStore } from '../../store/find-replace-store';
import { useEditorStore } from '../../store/editor-store';
import { getMatchInfo } from '../../editor/extensions/find-replace-extension';
import type { Editor } from '@tiptap/core';
import type { RawSearchHandle } from '../../editor/RawEditor';

interface FindReplaceDialogProps {
  editor: Editor | null;
  searchRef: React.MutableRefObject<RawSearchHandle | null>;
}

export function FindReplaceDialog({ editor, searchRef }: FindReplaceDialogProps) {
  const store = useFindReplaceStore();
  const { isRawMode } = useEditorStore();

  const posRef = useRef({ x: window.innerWidth - 460, y: 60 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus find input when opened
  useEffect(() => {
    if (store.isOpen) {
      setTimeout(() => findInputRef.current?.focus(), 0);
    }
  }, [store.isOpen]);

  // Read options fresh at call time so toggling matchCase/wholeWord/regex re-runs
  // the search with the correct flags even if this callback was memoised earlier.
  const triggerSearch = useCallback(
    (query: string) => {
      const options = useFindReplaceStore.getState().options;
      if (isRawMode) {
        searchRef.current?.setQuery(query, options);
        store.setMatchInfo(-1, -1);
      } else if (editor) {
        editor.commands.setSearchQuery(query, options);
        // Read synchronously — plugin state is updated immediately after dispatch
        const info = getMatchInfo(editor);
        store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
        store.setRegexError(info.regexError);
      }
    },
    [isRawMode, editor, searchRef, store.setMatchInfo, store.setRegexError],
  );

  // Re-run search when query or any option changes
  useEffect(() => {
    if (!store.isOpen) return;
    if (!store.query) {
      if (!isRawMode) editor?.commands.clearSearch();
      return;
    }
    triggerSearch(store.query);
  }, [store.query, store.options.matchCase, store.options.wholeWord, store.options.regex, store.options.inSelection, store.options.selectionFrom, store.options.selectionTo, store.isOpen, triggerSearch, isRawMode, editor]);

  const handleFindNext = useCallback(() => {
    store.setStatusMessage(null);
    if (store.query) store.pushFindHistory(store.query);
    if (isRawMode) {
      searchRef.current?.findNext();
    } else {
      editor?.commands.findNext();
      if (editor) {
        const info = getMatchInfo(editor);
        store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
      }
    }
  }, [isRawMode, editor, searchRef, store]);

  const handleFindPrev = useCallback(() => {
    store.setStatusMessage(null);
    if (store.query) store.pushFindHistory(store.query);
    if (isRawMode) {
      searchRef.current?.findPrev();
    } else {
      editor?.commands.findPrev();
      if (editor) {
        const info = getMatchInfo(editor);
        store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
      }
    }
  }, [isRawMode, editor, searchRef, store]);

  const handleReplace = useCallback(() => {
    if (store.replacement) store.pushReplaceHistory(store.replacement);
    if (isRawMode) {
      searchRef.current?.replace(store.replacement);
    } else {
      editor?.commands.replaceMatch(store.replacement);
      setTimeout(() => {
        triggerSearch(store.query);
      }, 30);
    }
  }, [isRawMode, editor, searchRef, store, triggerSearch]);

  const handleReplaceAll = useCallback(() => {
    if (store.query) store.pushFindHistory(store.query);
    if (store.replacement) store.pushReplaceHistory(store.replacement);
    if (isRawMode) {
      searchRef.current?.replaceAll(store.replacement);
      store.setStatusMessage('Replaced occurrences');
    } else {
      const countBefore = store.matchCount;
      editor?.commands.replaceAll(store.replacement);
      store.setStatusMessage(`Replaced ${countBefore} occurrence${countBefore !== 1 ? 's' : ''}`);
      setTimeout(() => {
        triggerSearch(store.query);
      }, 30);
    }
  }, [isRawMode, editor, searchRef, store, triggerSearch]);

  const handleClose = useCallback(() => {
    store.close();
    if (!isRawMode) editor?.commands.clearSearch();
    store.clearMatchState();
  }, [store, isRawMode, editor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleFindNext();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleFindPrev();
      } else if (e.key === 'F3' && e.shiftKey) {
        e.preventDefault();
        handleFindPrev();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleFindNext();
      }
    },
    [handleClose, handleFindNext, handleFindPrev],
  );

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !dialogRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      posRef.current = { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy };
      dialogRef.current.style.left = `${posRef.current.x}px`;
      dialogRef.current.style.top = `${posRef.current.y}px`;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (!store.isOpen) return null;

  const hasRegexError = !!store.regexError;

  const statusText = (() => {
    if (store.statusMessage) return store.statusMessage;
    if (!store.query) return null;
    if (store.regexError) return `Invalid regex: ${store.regexError}`;
    if (store.matchCount === 0) return 'No matches';
    if (store.matchCount === -1) return null;
    const scope = store.scopeLabel ? ` · Searching in: ${store.scopeLabel}` : '';
    return `${store.currentMatchIndex + 1} of ${store.matchCount} matches${scope}`;
  })();

  const statusColor =
    store.regexError || store.matchCount === 0
      ? 'text-red-500'
      : store.statusMessage
        ? 'text-green-600 dark:text-green-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      ref={dialogRef}
      className="fixed z-50 w-[420px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl select-none"
      style={{ left: posRef.current.x, top: posRef.current.y }}
      onKeyDown={handleKeyDown}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 cursor-move rounded-t-lg bg-gray-50 dark:bg-gray-800"
        onMouseDown={onMouseDown}
      >
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          Find &amp; Replace
        </span>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded p-0.5"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['find', 'replace'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => store.setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-medium capitalize border-b-2 transition-colors ${
              store.activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Find input */}
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={findInputRef}
                type="text"
                value={store.query}
                onChange={(e) => store.setQuery(e.target.value)}
                placeholder="Find…"
                list="find-history"
                className="w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="find-history">
                {store.findHistory.map((h, i) => (
                  <option key={i} value={h} />
                ))}
              </datalist>
            </div>
            <button
              onClick={handleFindPrev}
              disabled={!store.query || hasRegexError}
              title="Find Previous (Shift+Enter)"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={handleFindNext}
              disabled={!store.query || hasRegexError}
              title="Find Next (Enter)"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          {hasRegexError && (
            <p className="text-xs text-red-500 mt-1 ml-1">{store.regexError}</p>
          )}
        </div>

        {/* Replace input */}
        {store.activeTab === 'replace' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={store.replacement}
              onChange={(e) => store.setReplacement(e.target.value)}
              placeholder="Replace with…"
              list="replace-history"
              className="flex-1 px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <datalist id="replace-history">
              {store.replaceHistory.map((h, i) => (
                <option key={i} value={h} />
              ))}
            </datalist>
            <button
              onClick={() => {
                const tmp = store.query;
                store.setQuery(store.replacement);
                store.setReplacement(tmp);
              }}
              title="Swap find and replace"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ArrowUpDown size={14} />
            </button>
          </div>
        )}

        {/* Options */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(
            [
              ['matchCase', 'Match case'],
              ['wholeWord', 'Whole word'],
              ['regex', 'Regex'],
              ['wrap', 'Wrap'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={store.options[key] as boolean}
                onChange={(e) => {
                  store.setOption(key, e.target.checked);
                }}
                className="rounded"
              />
              {label}
            </label>
          ))}
          {store.activeTab === 'replace' && (
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={store.options.inSelection}
                disabled={store.scopeLabel !== null}
                onChange={(e) => {
                  if (!editor) return;
                  const { from, to, empty } = editor.state.selection;
                  if (e.target.checked && !empty) {
                    store.setOption('inSelection', true);
                    store.setOption('selectionFrom', from);
                    store.setOption('selectionTo', to);
                  } else {
                    store.setOption('inSelection', false);
                    store.setOption('selectionFrom', undefined);
                    store.setOption('selectionTo', undefined);
                  }
                }}
                className="rounded disabled:opacity-40"
              />
              In selection
            </label>
          )}
        </div>

        {/* Status */}
        {statusText && (
          <p className={`text-xs ${statusColor} min-h-[16px]`}>{statusText}</p>
        )}

        {/* Replace action buttons */}
        {store.activeTab === 'replace' && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleReplace}
              disabled={!store.query || hasRegexError}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Replace
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={!store.query || hasRegexError}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Replace All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
