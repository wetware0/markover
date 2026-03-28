import React, { useState } from 'react';
import { useEditorStore } from '../../store/editor-store';

interface Props {
  fileName: string;
  relativePath: string;
  absolutePath: string;
  base64Src: string;
  hasNativePath: boolean;
  onConfirm: (src: string, alt: string) => void;
  onCancel: () => void;
}

export function ImageDropDialog({
  fileName,
  relativePath,
  absolutePath,
  base64Src,
  hasNativePath,
  onConfirm,
  onCancel,
}: Props) {
  const docPath = useEditorStore((s) => s.filePath);
  const docSaved = !!docPath;

  const defaultRelative = hasNativePath && docSaved && !!relativePath;
  const [useRelative, setUseRelative] = useState(defaultRelative);
  const [useBase64, setUseBase64] = useState(!hasNativePath);
  const [alt, setAlt] = useState(fileName.replace(/\.[^.]+$/, ''));

  const effectiveSrc = useBase64 ? base64Src : useRelative ? relativePath : absolutePath;

  function handleRelativeChange(checked: boolean) {
    setUseRelative(checked);
    if (checked) setUseBase64(false);
  }

  function handleBase64Change(checked: boolean) {
    setUseBase64(checked);
    if (checked) setUseRelative(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-[480px] border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-4">Insert Image</h3>

        {/* Preview */}
        <div
          className="mb-4 flex justify-center bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 p-2"
          style={{ minHeight: '60px' }}
        >
          <img src={base64Src} alt={alt} style={{ maxHeight: '160px', maxWidth: '100%', objectFit: 'contain' }} />
        </div>

        {/* Alt text */}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alt Text</label>
        <input
          autoFocus
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
            if (e.key === 'Enter') onConfirm(effectiveSrc, alt);
          }}
          placeholder="Describe the image…"
          className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />

        {/* Path options */}
        <div className="space-y-2 mb-3">
          {hasNativePath && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={useRelative && !useBase64}
                onChange={(e) => handleRelativeChange(e.target.checked)}
                disabled={useBase64 || !docSaved}
                className="rounded"
              />
              <span className={`text-sm ${useBase64 || !docSaved ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                Use relative path
                {!docSaved && <span className="text-xs text-gray-400 ml-1">(save document first)</span>}
              </span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useBase64}
              onChange={(e) => handleBase64Change(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">Embed as Base64</span>
          </label>
        </div>

        {/* Path preview */}
        <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 rounded px-2 py-1.5 font-mono break-all mb-4">
          {useBase64 ? 'data:image/…;base64,…' : effectiveSrc || fileName}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(effectiveSrc, alt)}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
