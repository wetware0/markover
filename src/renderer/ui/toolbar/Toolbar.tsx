import React, { useState, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  Link,
  Image,
  Highlighter,
  Undo,
  Redo,
  Table,
  MessageSquarePlus,
  PanelRight,
  GitCompare,
  FileCode,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { useThemeStore } from '../../store/theme-store';
import { useUserStore, getInitials } from '../../store/user-store';

interface ToolbarProps {
  editor: Editor | null;
  isRawMode?: boolean;
  onToggleRawMode?: () => void;
  onAddComment?: () => void;
  onToggleSidebar?: () => void;
  trackChangesEnabled?: boolean;
  onToggleTrackChanges?: () => void;
  onOpenUserSettings?: () => void;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ onClick, isActive, disabled, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ${
        isActive ? 'bg-gray-200 dark:bg-gray-600 text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-1" />;
}

export function Toolbar({ editor, isRawMode, onToggleRawMode, onAddComment, onToggleSidebar, trackChangesEnabled, onToggleTrackChanges, onOpenUserSettings }: ToolbarProps) {
  const { mode, cycle } = useThemeStore();
  const { name, color } = useUserStore();
  const [linkDialog, setLinkDialog] = useState<{ href: string } | null>(null);
  const [imageInsertDialog, setImageInsertDialog] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  if (!editor && !isRawMode) return null;

  const iconSize = 18;
  const ThemeIcon = mode === 'light' ? Sun : mode === 'dark' ? Moon : Monitor;
  const themeLabel = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System';

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex-shrink-0 overflow-x-auto print:hidden">
      {/* Undo/Redo — WYSIWYG only (CodeMirror has its own history) */}
      {!isRawMode && editor && (<>
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="Undo (Ctrl+Z)">
          <Undo size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="Redo (Ctrl+Y)">
          <Redo size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Headings */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} isActive={editor.isActive('heading', { level: 1 })} title="Heading 1">
          <Heading1 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} isActive={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} isActive={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Inline formatting */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} isActive={editor.isActive('bold')} title="Bold (Ctrl+B)">
          <Bold size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} isActive={editor.isActive('italic')} title="Italic (Ctrl+I)">
          <Italic size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} isActive={editor.isActive('underline')} title="Underline (Ctrl+U)">
          <Underline size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} isActive={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} isActive={editor.isActive('code')} title="Inline Code (Ctrl+E)">
          <Code size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHighlight().run()} isActive={editor.isActive('highlight')} title="Highlight">
          <Highlighter size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Lists */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} isActive={editor.isActive('bulletList')} title="Bullet List">
          <List size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} isActive={editor.isActive('orderedList')} title="Numbered List">
          <ListOrdered size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleTaskList().run()} isActive={editor.isActive('taskList')} title="Task List">
          <ListTodo size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Block elements */}
        <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} isActive={editor.isActive('blockquote')} title="Blockquote">
          <Quote size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().toggleCodeBlock().run()} isActive={editor.isActive('codeBlock')} title="Code Block">
          <Code size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().setHorizontalRule().run()} title="Horizontal Rule">
          <Minus size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Insert */}
        <ToolbarButton
          onClick={() => setLinkDialog({ href: editor.getAttributes('link').href as string || '' })}
          isActive={editor.isActive('link')}
          title="Insert / Edit Link"
        >
          <Link size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setImageInsertDialog(true)}
          title="Insert Image"
        >
          <Image size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
          title="Insert Table"
        >
          <Table size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* Collaboration */}
        <ToolbarButton
          onClick={() => onAddComment?.()}
          disabled={editor.state.selection.from === editor.state.selection.to}
          title="Add Comment (select text first)"
        >
          <MessageSquarePlus size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => onToggleTrackChanges?.()}
          isActive={trackChangesEnabled}
          title={trackChangesEnabled ? 'Track Changes: ON' : 'Track Changes: OFF'}
        >
          <GitCompare size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />
      </>)}

      <div className="flex-1" />

      {/* Raw mode toggle */}
      <ToolbarButton
        onClick={() => onToggleRawMode?.()}
        isActive={isRawMode}
        title={isRawMode ? 'Switch to WYSIWYG' : 'Edit Raw Markdown'}
      >
        <FileCode size={iconSize} />
      </ToolbarButton>

      {/* User identity */}
      <button
        type="button"
        onClick={() => onOpenUserSettings?.()}
        title={name ? `Signed in as ${name}` : 'Set your identity'}
        className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold hover:opacity-80 transition-opacity select-none"
        style={{ backgroundColor: color }}
      >
        {getInitials(name) || '?'}
      </button>

      {/* Theme toggle */}
      <ToolbarButton onClick={cycle} title={`Theme: ${themeLabel}`}>
        <ThemeIcon size={iconSize} />
      </ToolbarButton>

      {/* Sidebar toggle — WYSIWYG only */}
      {!isRawMode && (
        <ToolbarButton onClick={() => onToggleSidebar?.()} title="Toggle Sidebar">
          <PanelRight size={iconSize} />
        </ToolbarButton>
      )}

      {/* Link dialog */}
      {linkDialog !== null && editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">Insert Link</h3>
            <input
              ref={linkInputRef}
              autoFocus
              type="text"
              defaultValue={linkDialog.href}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const href = linkInputRef.current?.value.trim();
                  if (href) editor.chain().focus().setLink({ href }).run();
                  else editor.chain().focus().unsetLink().run();
                  setLinkDialog(null);
                }
                if (e.key === 'Escape') { editor.chain().focus().run(); setLinkDialog(null); }
              }}
              placeholder="https://…"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex justify-between">
              {linkDialog.href && (
                <button
                  type="button"
                  onClick={() => { editor.chain().focus().unsetLink().run(); setLinkDialog(null); }}
                  className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950 rounded"
                >
                  Remove Link
                </button>
              )}
              <div className="flex gap-2 ml-auto">
                <button type="button" onClick={() => setLinkDialog(null)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
                <button
                  type="button"
                  onClick={() => {
                    const href = linkInputRef.current?.value.trim();
                    if (href) editor.chain().focus().setLink({ href }).run();
                    setLinkDialog(null);
                  }}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Image insert dialog */}
      {imageInsertDialog && editor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">Insert Image</h3>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Image URL</label>
            <input
              ref={imageInputRef}
              autoFocus
              type="text"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const src = imageInputRef.current?.value.trim();
                  if (src) editor.chain().focus().setImage({ src }).run();
                  setImageInsertDialog(false);
                }
                if (e.key === 'Escape') setImageInsertDialog(false);
              }}
              placeholder="https://…"
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setImageInsertDialog(false)} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Cancel</button>
              <button
                type="button"
                onClick={() => {
                  const src = imageInputRef.current?.value.trim();
                  if (src) editor.chain().focus().setImage({ src }).run();
                  setImageInsertDialog(false);
                }}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
