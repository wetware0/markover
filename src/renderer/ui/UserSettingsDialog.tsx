import React, { useState } from 'react';
import { useUserStore, USER_COLORS, getInitials } from '../store/user-store';

interface Props {
  onClose: () => void;
}

export function UserSettingsDialog({ onClose }: Props) {
  const { name, color, setName, setColor } = useUserStore();
  const [draft, setDraft] = useState(name);

  const save = () => {
    setName(draft.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-80 border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-4">Your Identity</h3>

        {/* Avatar preview */}
        <div className="flex justify-center mb-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-white font-bold text-xl select-none"
            style={{ backgroundColor: color }}
          >
            {getInitials(draft) || '?'}
          </div>
        </div>

        {/* Name */}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Display Name</label>
        <input
          autoFocus
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="Your name…"
          className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
        />

        {/* Color picker */}
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Color</label>
        <div className="flex gap-2 flex-wrap mb-4">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className="w-7 h-7 rounded-full transition-transform hover:scale-110"
              style={{
                backgroundColor: c,
                outline: color === c ? `3px solid ${c}` : 'none',
                outlineOffset: '2px',
              }}
              title={c}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
