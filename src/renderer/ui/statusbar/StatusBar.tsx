import React from 'react';
import { useEditorStore } from '../../store/editor-store';

export function StatusBar() {
  const { fileName, isDirty, wordCount, charCount, cursorLine, cursorCol } = useEditorStore();

  return (
    <div className="flex items-center justify-between px-4 py-1 text-xs text-gray-500 bg-gray-100 border-t border-gray-200 flex-shrink-0 select-none">
      <div className="flex items-center gap-4">
        <span>
          {fileName}
          {isDirty ? ' •' : ''}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
      </div>
    </div>
  );
}
