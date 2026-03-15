import React from 'react';
import { X } from 'lucide-react';
import packageJson from '../../../package.json';

interface Props {
  onClose: () => void;
}

export function AboutDialog({ onClose }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-80 border border-gray-200 dark:border-gray-700">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">About Markover</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center gap-3 text-center">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-bold select-none">
            M
          </div>
          <div>
            <p className="text-base font-semibold text-gray-800 dark:text-gray-100">Markover</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Version {packageJson.version}</p>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {packageJson.description}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            © {new Date().getFullYear()} {typeof packageJson.author === 'object' ? packageJson.author.name : packageJson.author}
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
