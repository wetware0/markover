import React, { useCallback, useEffect, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { nanoid } from 'nanoid';
import { useMarkoverEditor } from '../editor/use-editor';
import { useEditorStore } from '../store/editor-store';
import { useCommentsStore } from '../collaboration/comments/comment-store';
import { useTrackChangesStore } from '../collaboration/track-changes/track-changes-store';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { StatusBar } from '../ui/statusbar/StatusBar';
import { CommentsPanel } from '../collaboration/comments/CommentsPanel';
import { TrackChangesPanel } from '../collaboration/track-changes/TrackChangesPanel';
import { MessageSquare, GitCompare, X } from 'lucide-react';

type SidebarTab = 'comments' | 'changes';

export function App() {
  const { editor, loadContent, getMarkdown, getMetadata, setMetadata } = useMarkoverEditor();
  const { filePath, setFile, setDirty } = useEditorStore();
  const { setComments, comments, addComment, deleteComment: removeComment } = useCommentsStore();
  const { enabled: trackChangesEnabled, setEnabled: setTrackChangesEnabled, changes, setChanges, removeChange } = useTrackChangesStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('comments');

  // Sync track changes enabled state to the ProseMirror plugin
  useEffect(() => {
    if (!editor) return;
    const plugin = editor.extensionManager.extensions.find((e) => e.name === 'trackChangesPlugin');
    if (plugin) {
      (plugin.storage as Record<string, unknown>).enabled = trackChangesEnabled;
    }
  }, [editor, trackChangesEnabled]);

  // Sync comments store → metadata ref before save
  const syncCommentsToMetadata = useCallback(() => {
    const meta = getMetadata();
    meta.comments = comments;
    setMetadata(meta);
  }, [comments, getMetadata, setMetadata]);

  const handleSave = useCallback(async () => {
    syncCommentsToMetadata();
    const content = getMarkdown();
    if (filePath) {
      const result = await window.electronAPI.saveFile(filePath, content);
      if (result.success) setDirty(false);
    } else {
      const result = await window.electronAPI.saveFileAs(content);
      if (result) {
        setFile(result.filePath, result.filePath.split(/[\\/]/).pop() || 'Untitled');
        setDirty(false);
      }
    }
  }, [filePath, getMarkdown, setFile, setDirty, syncCommentsToMetadata]);

  const handleSaveAs = useCallback(async () => {
    syncCommentsToMetadata();
    const content = getMarkdown();
    const result = await window.electronAPI.saveFileAs(content);
    if (result) {
      setFile(result.filePath, result.filePath.split(/[\\/]/).pop() || 'Untitled');
      setDirty(false);
    }
  }, [getMarkdown, setFile, setDirty, syncCommentsToMetadata]);

  const handleNew = useCallback(() => {
    loadContent('');
    setFile(null, 'Untitled');
    setComments([]);
    setChanges([]);
  }, [loadContent, setFile, setComments, setChanges]);

  // Add comment to selected text
  const handleAddComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const commentId = nanoid(8);
    const content = window.prompt('Add a comment:');
    if (!content) return;

    editor.chain().focus().setMarkovHighlight({ commentId }).run();
    addComment(commentId, content);

    setSidebarOpen(true);
    setSidebarTab('comments');
  }, [editor, addComment]);

  // Delete comment
  const handleDeleteComment = useCallback(
    (commentId: string) => {
      if (!editor) return;
      editor.chain().focus().unsetMarkovHighlight(commentId).run();
      removeComment(commentId);
    },
    [editor, removeComment],
  );

  // Navigate to comment
  const handleNavigateToComment = useCallback(
    (commentId: string) => {
      if (!editor) return;
      const { doc } = editor.state;
      let targetPos: number | null = null;
      doc.descendants((node, pos) => {
        if (targetPos !== null) return false;
        if (!node.isText) return;
        const mark = node.marks.find(
          (m) => m.type.name === 'markovHighlight' && m.attrs.commentId === commentId,
        );
        if (mark) { targetPos = pos; return false; }
      });
      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
      }
    },
    [editor],
  );

  // Accept a tracked change
  const handleAcceptChange = useCallback(
    (changeId: string) => {
      if (!editor) return;
      const change = changes.find((c) => c.id === changeId);
      if (!change) return;

      if (change.type === 'insertion') {
        // Accept insertion: remove the mark, keep the text
        editor.chain().focus().unsetMarkovInsert(changeId).run();
      } else {
        // Accept deletion: remove the struck-through text entirely
        const { doc } = editor.state;
        const tr = editor.state.tr;
        tr.setMeta('trackChangesProcessed', true);
        const positions: Array<{ from: number; to: number }> = [];
        doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find(
            (m) => m.type.name === 'markovDelete' && m.attrs.changeId === changeId,
          );
          if (mark) positions.push({ from: pos, to: pos + node.nodeSize });
        });
        for (let i = positions.length - 1; i >= 0; i--) {
          tr.delete(positions[i].from, positions[i].to);
        }
        if (positions.length > 0) editor.view.dispatch(tr);
      }
      removeChange(changeId);
    },
    [editor, changes, removeChange],
  );

  // Reject a tracked change
  const handleRejectChange = useCallback(
    (changeId: string) => {
      if (!editor) return;
      const change = changes.find((c) => c.id === changeId);
      if (!change) return;

      if (change.type === 'insertion') {
        // Reject insertion: remove the inserted text entirely
        const { doc } = editor.state;
        const tr = editor.state.tr;
        tr.setMeta('trackChangesProcessed', true);
        const positions: Array<{ from: number; to: number }> = [];
        doc.descendants((node, pos) => {
          if (!node.isText) return;
          const mark = node.marks.find(
            (m) => m.type.name === 'markovInsert' && m.attrs.changeId === changeId,
          );
          if (mark) positions.push({ from: pos, to: pos + node.nodeSize });
        });
        for (let i = positions.length - 1; i >= 0; i--) {
          tr.delete(positions[i].from, positions[i].to);
        }
        if (positions.length > 0) editor.view.dispatch(tr);
      } else {
        // Reject deletion: remove the mark, keep the text (un-delete)
        editor.chain().focus().unsetMarkovDelete(changeId).run();
      }
      removeChange(changeId);
    },
    [editor, changes, removeChange],
  );

  // Accept/reject all
  const handleAcceptAll = useCallback(() => {
    changes.forEach((c) => handleAcceptChange(c.id));
  }, [changes, handleAcceptChange]);

  const handleRejectAll = useCallback(() => {
    [...changes].reverse().forEach((c) => handleRejectChange(c.id));
  }, [changes, handleRejectChange]);

  // Scan editor for tracked change marks to populate the changes list
  useEffect(() => {
    if (!editor) return;

    const scan = () => {
      const found: Array<{ id: string; type: 'insertion' | 'deletion'; author: string; date: string; text: string }> = [];
      const seen = new Set<string>();

      editor.state.doc.descendants((node, _pos) => {
        if (!node.isText) return;
        for (const mark of node.marks) {
          if (mark.type.name === 'markovInsert' && !seen.has(mark.attrs.changeId)) {
            seen.add(mark.attrs.changeId);
            found.push({
              id: mark.attrs.changeId,
              type: 'insertion',
              author: mark.attrs.author,
              date: mark.attrs.date,
              text: node.text || '',
            });
          }
          if (mark.type.name === 'markovDelete' && !seen.has(mark.attrs.changeId)) {
            seen.add(mark.attrs.changeId);
            found.push({
              id: mark.attrs.changeId,
              type: 'deletion',
              author: mark.attrs.author,
              date: mark.attrs.date,
              text: node.text || '',
            });
          }
        }
      });

      setChanges(found);
    };

    editor.on('update', scan);
    scan(); // Initial scan
    return () => { editor.off('update', scan); };
  }, [editor, setChanges]);

  // Handle file opened from main process (File > Open menu)
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFileChanged((data) => {
      loadContent(data.content);
      setFile(data.filePath, data.fileName);
      const meta = getMetadata();
      setComments(meta.comments);
    });
    return unsubscribe;
  }, [loadContent, setFile, getMetadata, setComments]);

  // Handle menu actions
  useEffect(() => {
    if (!editor) return;
    const unsubscribe = window.electronAPI.onMenuAction((action: string) => {
      switch (action) {
        case 'new': handleNew(); break;
        // 'open' is handled directly by main process menu → onFileChanged
        case 'save': handleSave(); break;
        case 'save-as': handleSaveAs(); break;
        case 'bold': editor.chain().focus().toggleBold().run(); break;
        case 'italic': editor.chain().focus().toggleItalic().run(); break;
        case 'underline': editor.chain().focus().toggleUnderline().run(); break;
        case 'strike': editor.chain().focus().toggleStrike().run(); break;
        case 'code': editor.chain().focus().toggleCode().run(); break;
        case 'code-block': editor.chain().focus().toggleCodeBlock().run(); break;
        case 'blockquote': editor.chain().focus().toggleBlockquote().run(); break;
        case 'horizontal-rule': editor.chain().focus().setHorizontalRule().run(); break;
        case 'add-comment': handleAddComment(); break;
        case 'toggle-track-changes':
          setTrackChangesEnabled(!trackChangesEnabled);
          break;
        case 'print':
          window.electronAPI.print();
          break;
        case 'export-pdf':
          window.electronAPI.exportPdf();
          break;
      }
    });
    return unsubscribe;
  }, [editor, handleNew, handleSave, handleSaveAs, handleAddComment, trackChangesEnabled, setTrackChangesEnabled]);

  return (
    <div className="flex flex-col h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Toolbar
        editor={editor}
        onAddComment={handleAddComment}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        trackChangesEnabled={trackChangesEnabled}
        onToggleTrackChanges={() => setTrackChangesEnabled(!trackChangesEnabled)}
      />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
          <div className="max-w-4xl mx-auto">
            <EditorContent editor={editor} className="min-h-full" />
          </div>
        </div>
        {sidebarOpen && (
          <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col flex-shrink-0">
            {/* Sidebar tabs */}
            <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setSidebarTab('comments')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'comments'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <MessageSquare size={14} /> Comments
              </button>
              <button
                type="button"
                onClick={() => setSidebarTab('changes')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${
                  sidebarTab === 'changes'
                    ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400 bg-white dark:bg-gray-900'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <GitCompare size={14} /> Changes
                {changes.length > 0 && (
                  <span className="bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 text-xs px-1.5 rounded-full">
                    {changes.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 hover:bg-gray-200 dark:hover:bg-gray-600 rounded mr-1"
              >
                <X size={14} />
              </button>
            </div>

            {/* Tab content */}
            {sidebarTab === 'comments' ? (
              <CommentsPanel
                onNavigateToComment={handleNavigateToComment}
                onDeleteComment={handleDeleteComment}
              />
            ) : (
              <TrackChangesPanel
                editor={editor}
                onAcceptChange={handleAcceptChange}
                onRejectChange={handleRejectChange}
                onAcceptAll={handleAcceptAll}
                onRejectAll={handleRejectAll}
              />
            )}
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
