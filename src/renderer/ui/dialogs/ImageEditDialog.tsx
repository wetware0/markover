import React, { useState } from 'react';

const WIDTH_PRESETS = [
  { label: 'Auto', value: '' },
  { label: '25%', value: '25%' },
  { label: '50%', value: '50%' },
  { label: '75%', value: '75%' },
  { label: '100%', value: '100%' },
];

interface Props {
  src: string;
  alt: string;
  width: string;
  href: string;
  onSave: (attrs: { src: string; alt: string; width: string; href: string }) => void;
  onCancel: () => void;
}

export function ImageEditDialog({ src: initialSrc, alt: initialAlt, width: initialWidth, href: initialHref, onSave, onCancel }: Props) {
  const [src, setSrc] = useState(initialSrc);
  const [alt, setAlt] = useState(initialAlt);
  const [width, setWidth] = useState(initialWidth);
  const [href, setHref] = useState(initialHref);

  function handleOpenLink() {
    if (!href.trim()) return;
    // Absolute file paths and URLs — let Electron/OS decide how to open them
    void window.electronAPI.openPath(href.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-[480px] border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-4">Edit Image</h3>

        {src && (
          <div className="mb-4 flex justify-center bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 p-2" style={{ minHeight: '60px' }}>
            <img src={src} alt={alt} style={{ maxHeight: '160px', maxWidth: '100%', objectFit: 'contain' }} />
          </div>
        )}

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Image URL</label>
        <input
          autoFocus
          type="text"
          value={src}
          onChange={(e) => setSrc(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          placeholder="https://…"
          className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Alt Text</label>
        <input
          type="text"
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          placeholder="Describe the image…"
          className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
        />

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Link (href)</label>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
            placeholder="Path or URL the image links to…"
            className="flex-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={handleOpenLink}
            disabled={!href.trim()}
            title="Open linked file or URL"
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded hover:border-blue-400 hover:text-blue-600 disabled:opacity-40"
          >
            Open
          </button>
        </div>

        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Width</label>
        <div className="flex gap-2 items-center flex-wrap">
          {WIDTH_PRESETS.map(({ label, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => setWidth(value)}
              className={`px-2.5 py-1 text-xs rounded border transition-colors ${
                width === value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-400'
              }`}
            >
              {label}
            </button>
          ))}
          <input
            type="text"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            placeholder="e.g. 320px"
            className="flex-1 min-w-0 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave({ src, alt, width, href })}
            disabled={!src.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
