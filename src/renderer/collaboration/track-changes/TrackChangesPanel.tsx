import React from 'react';
import { useTrackChangesStore } from './track-changes-store';
import { Check, X, CheckCheck, XCircle, GitCompare } from 'lucide-react';

interface TrackChangesPanelProps {
  onAcceptChange: (changeId: string) => void;
  onRejectChange: (changeId: string) => void;
  onAcceptAll: () => void;
  onRejectAll: () => void;
  onNavigateToChange: (changeId: string) => void;
  /** Called after panel actions that don't already move focus (returns it to the editor). */
  onAfterAction: () => void;
}

/** Mouse clicks on panel buttons must not pull focus away from the editor. */
const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault();

export function TrackChangesPanel({
  onAcceptChange,
  onRejectChange,
  onAcceptAll,
  onRejectAll,
  onNavigateToChange,
  onAfterAction,
}: TrackChangesPanelProps) {
  const { enabled, toggle, changes } = useTrackChangesStore();

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
          <GitCompare size={16} />
          Track Changes
        </div>
        <button
          type="button"
          onMouseDown={keepEditorFocus}
          onClick={() => { toggle(); onAfterAction(); }}
          title={enabled ? 'Stop tracking changes' : 'Start tracking changes'}
          className={`text-xs px-2 py-0.5 rounded font-medium transition-colors ${
            enabled
              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {changes.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <button
            type="button"
            onMouseDown={keepEditorFocus}
            onClick={onAcceptAll}
            className="flex items-center gap-1 text-xs text-green-600 hover:bg-green-50 rounded px-2 py-1"
          >
            <CheckCheck size={12} /> Accept All
          </button>
          <button
            type="button"
            onMouseDown={keepEditorFocus}
            onClick={onRejectAll}
            className="flex items-center gap-1 text-xs text-red-500 hover:bg-red-50 rounded px-2 py-1"
          >
            <XCircle size={12} /> Reject All
          </button>
          <span className="ml-auto text-xs text-gray-400">
            {changes.length} change{changes.length === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {changes.length === 0 ? (
          <div className="p-4 text-sm text-gray-400 dark:text-gray-500 text-center">
            {enabled
              ? 'No changes tracked yet. Start editing to track changes.'
              : 'Track changes is off. Turn it on to start tracking.'}
          </div>
        ) : (
          changes.map((change) => (
            <div
              key={`${change.type}:${change.id}`}
              data-change-id={change.id}
              className="markover-change-entry flex items-start gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750 cursor-pointer"
              onMouseDown={keepEditorFocus}
              onClick={() => onNavigateToChange(change.id)}
              title="Show in document"
            >
              <div
                className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                  change.type === 'insertion' ? 'bg-green-500' : 'bg-red-500'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{change.author}</span>
                  <span
                    className={`text-xs px-1 py-0.5 rounded ${
                      change.type === 'insertion'
                        ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                        : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                    }`}
                  >
                    {change.type === 'insertion' ? 'Added' : 'Deleted'}
                  </span>
                  <span className="text-xs text-gray-400">{change.date}</span>
                </div>
                <p
                  className={`text-sm line-clamp-2 break-words whitespace-pre-wrap ${
                    change.type === 'deletion' ? 'line-through text-red-600' : 'text-green-700'
                  }`}
                >
                  {change.text.trim() ? change.text : '(whitespace)'}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onMouseDown={keepEditorFocus}
                  onClick={(e) => { e.stopPropagation(); onAcceptChange(change.id); }}
                  className="p-1 text-green-600 hover:bg-green-100 rounded"
                  title="Accept"
                >
                  <Check size={14} />
                </button>
                <button
                  type="button"
                  onMouseDown={keepEditorFocus}
                  onClick={(e) => { e.stopPropagation(); onRejectChange(change.id); }}
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
