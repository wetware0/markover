import React, { useState, useEffect, useRef } from 'react';
import mermaid from 'mermaid';

let previewCounter = 0;

interface Props {
  code: string;
  onSave: (code: string) => void;
  onCancel: () => void;
}

export function MermaidEditDialog({ code: initialCode, onSave, onCancel }: Props) {
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!previewRef.current) return;
    if (!code.trim()) {
      previewRef.current.innerHTML = '';
      setError(null);
      return;
    }
    const id = `mermaid-preview-${++previewCounter}`;
    mermaid.render(id, code)
      .then(({ svg }) => {
        if (previewRef.current) {
          previewRef.current.innerHTML = svg;
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (previewRef.current) previewRef.current.innerHTML = '';
        setError(String(err));
      });
  }, [code]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-[700px] max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">Edit Diagram</h3>
        <div className="flex gap-3 flex-1 min-h-0" style={{ minHeight: '280px' }}>
          <textarea
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            placeholder="Mermaid source…"
            className="flex-1 font-mono text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="flex-1 overflow-auto p-2 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700">
            {error
              ? <pre className="text-xs text-red-500 whitespace-pre-wrap">{error}</pre>
              : <div ref={previewRef} />
            }
          </div>
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
            onClick={() => onSave(code)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
