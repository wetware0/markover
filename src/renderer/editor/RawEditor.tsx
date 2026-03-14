import React from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';

interface RawEditorProps {
  value: string;
  onChange: (value: string) => void;
  isDark: boolean;
}

export function RawEditor({ value, onChange, isDark }: RawEditorProps) {
  return (
    <div className="flex-1 overflow-auto h-full">
      <CodeMirror
        value={value}
        height="100%"
        theme={isDark ? oneDark : 'light'}
        extensions={[markdown({ codeLanguages: languages })]}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          indentOnInput: true,
        }}
        style={{ height: '100%', fontSize: '13px' }}
      />
    </div>
  );
}
