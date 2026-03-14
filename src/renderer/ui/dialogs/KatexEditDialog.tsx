import React, { useState, useEffect, useRef } from 'react';
import katex from 'katex';

interface Props {
  math: string;
  displayMode: boolean;
  onSave: (math: string) => void;
  onCancel: () => void;
}

export function KatexEditDialog({ math: initialMath, displayMode, onSave, onCancel }: Props) {
  const [math, setMath] = useState(initialMath);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewRef.current) return;
    try {
      katex.render(math, previewRef.current, { throwOnError: false, displayMode });
    } catch {
      if (previewRef.current) previewRef.current.textContent = math;
    }
  }, [math, displayMode]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-[520px] border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">
          Edit {displayMode ? 'Block' : 'Inline'} Math
        </h3>
        <textarea
          autoFocus
          value={math}
          onChange={(e) => setMath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !displayMode) { e.preventDefault(); onSave(math); }
            if (e.key === 'Escape') onCancel();
          }}
          placeholder="LaTeX source…"
          rows={displayMode ? 4 : 2}
          className="w-full font-mono text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <div className="mt-3 p-3 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 min-h-[2rem] text-center overflow-x-auto">
          <div ref={previewRef} />
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(math)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
