import React from 'react';
import { useTrackChangesStore } from './track-changes-store';
import { Check, X, CheckCheck, XCircle, GitCompare } from 'lucide-react';
import type { Editor } from '@tiptap/core';

interface TrackChangesPanelProps {
  editor: Editor | null;
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

export function TrackChangesPanel({
  editor,
  onAcceptChange,
  onRejectChange,
  onAcceptAll,
  onRejectAll,
}: TrackChangesPanelProps) {
  const { enabled, toggle, changes } = useTrackChangesStore();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
          <GitCompare size={16} />
          Track Changes
        </div>
        <button
          type="button"
          onClick={toggle}
          className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
            enabled
              ? 'bg-green-100 text-green-700 hover:bg-green-200'
              : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {changes.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onAcceptAll}
            className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-50 rounded px-2 py-1"
          >
            <CheckCheck size={12} /> Accept All
          </button>
          <button
            type="button"
            onClick={onRejectAll}
            className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 rounded px-2 py-1"
          >
            <XCircle size={12} /> Reject All
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <div className="p-4 text-sm text-gray-400 text-center">
            {enabled
              ? 'No changes tracked yet. Start editing to track changes.'
              : 'Track changes is off. Turn it on to start tracking.'}
          </div>
        ) : (
          changes.map((change) => (
            <div
              key={change.id}
              className="flex items-start gap-2 px-3 py-2 border-b border-gray-100 hover:bg-gray-50"
            >
              <div
                className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  change.type === 'insertion' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-gray-700">{change.author}</span>
                  <span
                    className={`text-xs px-1 py-0.5 rounded ${
                      change.type === 'insertion'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {change.type === 'insertion' ? 'Added' : 'Deleted'}
                  </span>
                  <span className="text-xs text-gray-400">{change.date}</span>
                </div>
                <p
                  className={`text-sm truncate ${
                    change.type === 'deletion' ? 'line-through text-red-600' : 'text-green-700'
                  }`}
                >
                  {change.text || '(empty)'}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onAcceptChange(change.id)}
                  className="p-1 text-green-600 hover:bg-green-100 rounded"
                  title="Accept"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => onRejectChange(change.id)}
                  className="p-1 text-red-500 hover:bg-red-100 rounded"
                  title="Reject"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
