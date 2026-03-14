import React from 'react';
import { BubbleMenu } from '@tiptap/react';
import type { Editor } from '@tiptap/core';
import { moveTableColumn, moveTableRow, selectedRect } from 'prosemirror-tables';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
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
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 bg-gray-200 dark:bg-gray-600 mx-0.5" />;
}

function runCommand(
  editor: Editor,
  cmd: (state: Editor['state'], dispatch: (tr: Editor['state']['tr']) => void) => boolean,
) {
  cmd(editor.state, (tr) => editor.view.dispatch(tr));
}

export function TableBubbleMenu({ editor }: Props) {
  const sz = 14;

  const colIndex = (): number => {
    try { return selectedRect(editor.state).left; } catch { return -1; }
  };
  const colCount = (): number => {
    try { return selectedRect(editor.state).map.width; } catch { return 0; }
  };
  const rowIndex = (): number => {
    try { return selectedRect(editor.state).top; } catch { return -1; }
  };
  const rowCount = (): number => {
    try { return selectedRect(editor.state).map.height; } catch { return 0; }
  };

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }) => e.isActive('table')}
      tippyOptions={{ placement: 'top', interactive: true, offset: [0, 8] }}
    >
      <div className="flex items-center gap-0 px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg">

        {/* Column operations */}
        <Btn onClick={() => editor.chain().focus().addColumnBefore().run()} title="Insert column before">
          <ArrowLeftToLine size={sz} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Insert column after">
          <ArrowRightToLine size={sz} />
        </Btn>
        <Btn
          onClick={() => {
            const col = colIndex();
            if (col > 0) runCommand(editor, moveTableColumn({ from: col, to: col - 1 }));
          }}
          title="Move column left"
        >
          <ArrowLeft size={sz} />
        </Btn>
        <Btn
          onClick={() => {
            const col = colIndex();
            if (col >= 0 && col < colCount() - 1) runCommand(editor, moveTableColumn({ from: col, to: col + 1 }));
          }}
          title="Move column right"
        >
          <ArrowRight size={sz} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column" danger>
          <span className="flex items-center gap-0.5 text-xs"><Trash2 size={sz} />Col</span>
        </Btn>

        <Sep />

        {/* Row operations */}
        <Btn onClick={() => editor.chain().focus().addRowBefore().run()} title="Insert row above">
          <ArrowUpToLine size={sz} />
        </Btn>
        <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title="Insert row below">
          <ArrowDownToLine size={sz} />
        </Btn>
        <Btn
          onClick={() => {
            const row = rowIndex();
            if (row > 0) runCommand(editor, moveTableRow({ from: row, to: row - 1 }));
          }}
          title="Move row up"
        >
          <ArrowUpToLine size={sz} className="rotate-90" />
        </Btn>
        <Btn
          onClick={() => {
            const row = rowIndex();
            if (row >= 0 && row < rowCount() - 1) runCommand(editor, moveTableRow({ from: row, to: row + 1 }));
          }}
          title="Move row down"
        >
          <ArrowDownToLine size={sz} className="rotate-90" />
        </Btn>
        <Btn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row" danger>
          <span className="flex items-center gap-0.5 text-xs"><Trash2 size={sz} />Row</span>
        </Btn>

        <Sep />

        {/* Delete table */}
        <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="Delete entire table" danger>
          <span className="flex items-center gap-0.5 text-xs"><TableProperties size={sz} /><Trash2 size={sz} /></span>
        </Btn>
      </div>
    </BubbleMenu>
  );
}
