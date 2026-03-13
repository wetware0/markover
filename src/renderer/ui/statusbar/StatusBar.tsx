import React from 'react';
import { useEditorStore } from '../../store/editor-store';
import { useTrackChangesStore } from '../../collaboration/track-changes/track-changes-store';
import { SpellCheck } from 'lucide-react';

export function StatusBar() {
  const { fileName, isDirty, wordCount, charCount, cursorLine, cursorCol } = useEditorStore();
  const { enabled: trackChangesOn } = useTrackChangesStore();

  return (
    <div className="flex items-center justify-between px-4 py-1 text-xs text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 select-none">
      <div className="flex items-center gap-4">
        <span>
          {fileName}
          {isDirty ? ' \u2022' : ''}
        </span>
        {trackChangesOn && (
          <span className="text-green-600 font-medium">Track Changes</span>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <SpellCheck size={12} /> Spell Check
        </span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
      </div>
    </div>
  );
}
