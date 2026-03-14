import React from 'react';
import type { Editor } from '@tiptap/core';
import { moveTableColumn, moveTableRow, selectedRect } from 'prosemirror-tables';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  TableProperties,
} from 'lucide-react';

interface Props {
  editor: Editor;
}

function Btn({
  onClick,
  title,
  children,
  danger,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1 rounded transition-colors ${
        danger
          ? 'text-red-500 hover:bg-red-100 dark:hover:bg-red-950'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />;
}

function runCmd(
  editor: Editor,
  cmd: (state: Editor['state'], dispatch: (tr: Editor['state']['tr']) => void) => boolean,
) {
  cmd(editor.state, (tr) => editor.view.dispatch(tr));
}

function colIndex(editor: Editor): number {
  try { return selectedRect(editor.state).left; } catch { return -1; }
}
function colCount(editor: Editor): number {
  try { return selectedRect(editor.state).map.width; } catch { return 0; }
}
function rowIndex(editor: Editor): number {
  try { return selectedRect(editor.state).top; } catch { return -1; }
}
function rowCount(editor: Editor): number {
  try { return selectedRect(editor.state).map.height; } catch { return 0; }
}

export function TableContextBar({ editor }: Props) {
  if (!editor.isActive('table')) return null;

  const sz = 14;

  return (
    <div className="flex items-center gap-0 px-3 py-0.5 border-b border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 flex-shrink-0 overflow-x-auto">
      <span className="text-xs font-medium text-blue-600 dark:text-blue-400 mr-2 select-none">Table</span>

      {/* Column */}
      <Btn onClick={() => editor.chain().focus().addColumnBefore().run()} title="Insert column before">
        <ArrowLeftToLine size={sz} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Insert column after">
        <ArrowRightToLine size={sz} />
      </Btn>
      <Btn
        onClick={() => { const c = colIndex(editor); if (c > 0) runCmd(editor, moveTableColumn({ from: c, to: c - 1 })); }}
        title="Move column left"
      >
        <ArrowLeft size={sz} />
      </Btn>
      <Btn
        onClick={() => { const c = colIndex(editor); if (c >= 0 && c < colCount(editor) - 1) runCmd(editor, moveTableColumn({ from: c, to: c + 1 })); }}
        title="Move column right"
      >
        <ArrowRight size={sz} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column" danger>
        <span className="flex items-center gap-0.5 text-xs"><Trash2 size={sz} />Col</span>
      </Btn>

      <Sep />

      {/* Row */}
      <Btn onClick={() => editor.chain().focus().addRowBefore().run()} title="Insert row above">
        <ArrowUpToLine size={sz} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title="Insert row below">
        <ArrowDownToLine size={sz} />
      </Btn>
      <Btn
        onClick={() => { const r = rowIndex(editor); if (r > 0) runCmd(editor, moveTableRow({ from: r, to: r - 1 })); }}
        title="Move row up"
      >
        <ArrowUp size={sz} />
      </Btn>
      <Btn
        onClick={() => { const r = rowIndex(editor); if (r >= 0 && r < rowCount(editor) - 1) runCmd(editor, moveTableRow({ from: r, to: r + 1 })); }}
        title="Move row down"
      >
        <ArrowDown size={sz} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row" danger>
        <span className="flex items-center gap-0.5 text-xs"><Trash2 size={sz} />Row</span>
      </Btn>

      <Sep />

      {/* Table */}
      <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="Delete entire table" danger>
        <span className="flex items-center gap-0.5 text-xs"><TableProperties size={sz} /><Trash2 size={sz} /></span>
      </Btn>
    </div>
  );
}
