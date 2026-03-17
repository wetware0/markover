// src/renderer/editor/RawEditor.tsx
import React, { useRef, useEffect } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { SearchQuery, findNext, findPrevious, replaceNext, replaceAll, search } from '@codemirror/search';
import type { SearchOptions } from '../store/find-replace-store';

export interface RawSearchHandle {
  setQuery: (query: string, options: SearchOptions) => void;
  findNext: () => void;
  findPrev: () => void;
  replace: (replacement: string) => void;
  replaceAll: (replacement: string) => void;
  getMatchInfo: () => { current: number; total: number };
}

interface RawEditorProps {
  value: string;
  onChange: (value: string) => void;
  isDark: boolean;
  searchRef?: React.MutableRefObject<RawSearchHandle | null>;
}

export function RawEditor({ value, onChange, isDark, searchRef }: RawEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const currentQueryRef = useRef<{ query: string; options: SearchOptions } | null>(null);

  useEffect(() => {
    if (!searchRef) return;
    searchRef.current = {
      setQuery(query, options) {
        currentQueryRef.current = { query, options };
        const view = cmRef.current?.view;
        if (!view || !query) return;
        const sq = new SearchQuery({
          search: query,
          caseSensitive: options.matchCase,
          wholeWord: options.wholeWord,
          regexp: options.regex,
          replace: '',
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
      },
      findNext() {
        const view = cmRef.current?.view;
        if (view) findNext(view);
      },
      findPrev() {
        const view = cmRef.current?.view;
        if (view) findPrevious(view);
      },
      replace(replacement) {
        const view = cmRef.current?.view;
        if (!view || !currentQueryRef.current) return;
        const sq = new SearchQuery({
          search: currentQueryRef.current.query,
          caseSensitive: currentQueryRef.current.options.matchCase,
          wholeWord: currentQueryRef.current.options.wholeWord,
          regexp: currentQueryRef.current.options.regex,
          replace: replacement,
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
        replaceNext(view);
      },
      replaceAll(replacement) {
        const view = cmRef.current?.view;
        if (!view || !currentQueryRef.current) return;
        const sq = new SearchQuery({
          search: currentQueryRef.current.query,
          caseSensitive: currentQueryRef.current.options.matchCase,
          wholeWord: currentQueryRef.current.options.wholeWord,
          regexp: currentQueryRef.current.options.regex,
          replace: replacement,
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
        replaceAll(view);
      },
      getMatchInfo() {
        // CodeMirror does not expose match count directly; return -1 to signal unknown.
        return { current: -1, total: -1 };
      },
    };
    return () => {
      if (searchRef) searchRef.current = null;
    };
  }, [searchRef]);

  return (
    <div className="flex-1 overflow-auto h-full">
      <CodeMirror
        ref={cmRef}
        value={value}
        height="100%"
        theme={isDark ? oneDark : 'light'}
        extensions={[
          markdown({ codeLanguages: languages }),
          EditorView.contentAttributes.of({ spellcheck: 'true' }),
          search({ top: false }),
        ]}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          indentOnInput: true,
          searchKeymap: false,
        }}
        style={{ height: '100%', fontSize: '13px' }}
      />
    </div>
  );
}
