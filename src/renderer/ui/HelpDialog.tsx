import React, { useState } from 'react';
import { X, Search } from 'lucide-react';

interface Section {
  title: string;
  items: { keys?: string[]; label: string; description?: string }[];
}

const SECTIONS: Section[] = [
  {
    title: 'File',
    items: [
      { keys: ['Ctrl', 'N'], label: 'New document' },
      { keys: ['Ctrl', 'O'], label: 'Open file' },
      { keys: ['Ctrl', 'S'], label: 'Save' },
      { keys: ['Ctrl', 'Shift', 'S'], label: 'Save As' },
      { keys: ['Ctrl', 'Shift', 'P'], label: 'Publish', description: 'Export clean markdown — strips all comments, accepts all tracked changes' },
      { keys: ['Ctrl', 'P'], label: 'Print' },
    ],
  },
  {
    title: 'Formatting',
    items: [
      { keys: ['Ctrl', 'B'], label: 'Bold' },
      { keys: ['Ctrl', 'I'], label: 'Italic' },
      { keys: ['Ctrl', 'U'], label: 'Underline' },
      { keys: ['Ctrl', 'Shift', 'X'], label: 'Strikethrough' },
      { keys: ['Ctrl', 'E'], label: 'Inline code' },
      { keys: ['Ctrl', 'Shift', 'E'], label: 'Code block' },
      { keys: ['Ctrl', 'Shift', 'B'], label: 'Blockquote' },
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Y'], label: 'Redo' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['Ctrl', 'Shift', 'R'], label: 'Toggle raw markdown mode', description: 'Switch between WYSIWYG and syntax-highlighted source editing (CodeMirror)' },
    ],
  },
  {
    title: 'Comments',
    items: [
      { label: 'Add comment', description: 'Select text, then click the speech-bubble-plus icon in the toolbar. Enter your comment and press Enter or click Add Comment.' },
      { label: 'View comments', description: 'Click the panel icon (⊞) in the toolbar to open the sidebar, then select the Comments tab.' },
      { label: 'Reply to a comment', description: 'Click on a comment thread in the sidebar to expand it, then type a reply.' },
      { label: 'Resolve / delete', description: 'Use the ✓ and ✕ buttons in each comment thread.' },
      { label: 'Navigate to highlight', description: 'Click on a comment in the sidebar to scroll the editor to the highlighted text.' },
    ],
  },
  {
    title: 'Track Changes',
    items: [
      { label: 'Enable tracking', description: 'Click the git-compare icon in the toolbar, or use Edit > Track Changes. While enabled, all insertions appear in green and deletions in red with strikethrough.' },
      { label: 'Accept / reject a change', description: 'Open the sidebar (Changes tab) and click ✓ to accept or ✕ to reject each change.' },
      { label: 'Accept / reject all', description: 'Use the Accept All or Reject All buttons at the top of the Changes panel.' },
      { label: 'Author name', description: 'Click your avatar (initials circle) in the toolbar to set your display name and colour.' },
    ],
  },
  {
    title: 'Math (KaTeX)',
    items: [
      { label: 'Inline math', description: 'Write $…$ in raw mode. The formula renders inline in WYSIWYG mode. Double-click to edit.' },
      { label: 'Block math', description: 'Write $$\\n…\\n$$ in raw mode. Renders centred on its own line. Double-click to edit.' },
      { label: 'Edit math', description: 'Double-click any rendered formula to open the edit dialog with a live preview.' },
    ],
  },
  {
    title: 'Diagrams (Mermaid)',
    items: [
      { label: 'Insert diagram', description: 'Write a fenced code block with language "mermaid" in raw mode. The diagram renders automatically.' },
      { label: 'Edit diagram', description: 'Double-click the rendered diagram to open a side-by-side editor with live preview.' },
      { label: 'Example', description: '```mermaid\ngraph LR\n  A --> B --> C\n```' },
    ],
  },
  {
    title: 'Tables',
    items: [
      { label: 'Insert table', description: 'Click the table icon in the toolbar to insert a 3×3 table with a header row.' },
      { label: 'Edit table', description: 'Click inside a table cell to position your cursor. A blue "Table" toolbar strip appears above the editor with controls to insert/move/delete rows and columns.' },
      { label: 'Resize columns', description: 'Drag the column borders to resize (column resizing is enabled).' },
    ],
  },
  {
    title: 'Images',
    items: [
      { label: 'Insert from URL', description: 'Click the image icon in the toolbar and paste a URL.' },
      { label: 'Drop or paste', description: 'Drag an image file onto the editor or paste from clipboard.' },
      { label: 'Edit image', description: 'Double-click any image to open the edit dialog: change the URL, alt text, and width (25 / 50 / 75 / 100% presets or custom value).' },
    ],
  },
  {
    title: 'Other Markdown',
    items: [
      { label: 'Task lists', description: 'Use - [ ] or - [x] syntax, or the checkbox-list toolbar button.' },
      { label: 'Footnotes', description: 'Write [^1] in text and [^1]: text at the end.' },
      { label: 'YAML front matter', description: 'A --- … --- block at the top of the file is shown as a styled "Front Matter" card.' },
      { label: 'Syntax-highlighted code', description: 'Fenced code blocks with a language tag (e.g. ```ts) are highlighted using Shiki.' },
      { label: 'Highlights', description: 'Select text and click the highlighter icon to apply a yellow background mark.' },
    ],
  },
  {
    title: 'File Format (.md)',
    items: [
      { label: 'Standard markdown', description: 'Markover saves standard CommonMark-compatible .md files that open in any markdown editor.' },
      { label: 'Comment metadata', description: 'Comment threads are stored as HTML comments (<!-- markover:comment … -->) at the end of the file — invisible in other editors.' },
      { label: 'Track-change marks', description: 'Insertions and deletions are stored as inline <span data-markov="ins/del"> tags — ignored by most markdown renderers.' },
      { label: 'Publish', description: 'Use File > Publish to export a clean .md file with all metadata stripped and all tracked changes accepted.' },
    ],
  },
];

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-700 dark:text-gray-300">
      {children}
    </kbd>
  );
}

interface Props {
  onClose: () => void;
}

export function HelpDialog({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();

  const filtered = q
    ? SECTIONS.map((s) => ({
        ...s,
        items: s.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            (item.description?.toLowerCase().includes(q) ?? false) ||
            (item.keys?.join(' ').toLowerCase().includes(q) ?? false),
        ),
      })).filter((s) => s.items.length > 0)
    : SECTIONS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-[680px] max-h-[80vh] flex flex-col border border-gray-200 dark:border-gray-700">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">Markover User Guide</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg">
            <Search size={14} className="text-gray-400" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { if (query) setQuery(''); else onClose(); } }}
              placeholder="Search…"
              className="flex-1 bg-transparent text-sm text-gray-700 dark:text-gray-200 outline-none placeholder-gray-400"
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No results for "{query}"</p>
          )}
          {filtered.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
                {section.title}
              </h3>
              <div className="space-y-2">
                {section.items.map((item, i) => (
                  <div key={i} className="flex gap-4 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
                    {item.keys && (
                      <div className="flex items-center gap-1 flex-shrink-0 min-w-[140px]">
                        {item.keys.map((k, ki) => (
                          <React.Fragment key={k}>
                            {ki > 0 && <span className="text-gray-400 text-xs">+</span>}
                            <Kbd>{k}</Kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    <div className={item.keys ? '' : 'pl-0'}>
                      <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{item.label}</div>
                      {item.description && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 whitespace-pre-line">
                          {item.description}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 text-center">
          Markover — Markdown WYSIWYG editor with Word-like collaboration
        </div>
      </div>
    </div>
  );
}
