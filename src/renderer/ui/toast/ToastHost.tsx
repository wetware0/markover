import React from 'react';
import { X } from 'lucide-react';
import { useToastStore } from './toast-store';

const KIND_CLASSES: Record<string, string> = {
  info: 'bg-gray-800 text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-start gap-2 rounded px-3 py-2 text-sm shadow-lg ${KIND_CLASSES[t.kind]}`}
        >
          <span className="flex-1 whitespace-pre-wrap">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="opacity-70 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
