import React, { useCallback, useEffect, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { nanoid } from 'nanoid';
import { useMarkoverEditor } from '../editor/use-editor';
import { useEditorStore } from '../store/editor-store';
import { useCommentsStore } from '../collaboration/comments/comment-store';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { StatusBar } from '../ui/statusbar/StatusBar';
import { CommentsPanel } from '../collaboration/comments/CommentsPanel';
import { MessageSquare, X } from 'lucide-react';

export function App() {
  const { editor, loadContent, getMarkdown, getMetadata, setMetadata } = useMarkoverEditor();
  const { filePath, setFile, setDirty } = useEditorStore();
  const { setComments, comments, addComment, deleteComment: removeComment } = useCommentsStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Sync comments store → metadata ref before save
  const syncCommentsToMetadata = useCallback(() => {
    const meta = getMetadata();
    meta.comments = comments;
    setMetadata(meta);
  }, [comments, getMetadata, setMetadata]);

  const handleOpen = useCallback(async () => {
    const result = await window.electronAPI.openFile();
    if (result) {
      loadContent(result.content);
      setFile(result.filePath, result.fileName);
      // Load comments from metadata into store
      const meta = getMetadata();
      setComments(meta.comments);
    }
  }, [loadContent, setFile, getMetadata, setComments]);

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
  }, [loadContent, setFile, setComments]);

  // Add comment to selected text
  const handleAddComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return; // Need a selection

    const commentId = nanoid(8);
    const content = window.prompt('Add a comment:');
    if (!content) return;

    // Apply highlight mark
    editor.chain().focus().setMarkovHighlight({ commentId }).run();

    // Add to comments store
    addComment(commentId, content);

    // Also add highlight to metadata
    const meta = getMetadata();
    meta.highlights.push({
      id: commentId,
      startOffset: 0, // Will be recalculated at save time
      endOffset: 0,
    });
    setMetadata(meta);

    setSidebarOpen(true);
  }, [editor, addComment, getMetadata, setMetadata]);

  // Delete comment and remove highlight
  const handleDeleteComment = useCallback(
    (commentId: string) => {
      if (!editor) return;
      editor.chain().focus().unsetMarkovHighlight(commentId).run();
      removeComment(commentId);

      // Remove from metadata
      const meta = getMetadata();
      meta.highlights = meta.highlights.filter((h) => h.id !== commentId);
      meta.comments = meta.comments.filter((c) => c.id !== commentId);
      setMetadata(meta);
    },
    [editor, removeComment, getMetadata, setMetadata],
  );

  // Navigate to a comment's highlighted text
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
        if (mark) {
          targetPos = pos;
          return false;
        }
      });

      if (targetPos !== null) {
        editor.chain().focus().setTextSelection(targetPos).run();
      }
    },
    [editor],
  );

  // Handle menu actions from main process
  useEffect(() => {
    if (!editor) return;

    const unsubscribe = window.electronAPI.onMenuAction((action: string) => {
      switch (action) {
        case 'new':
          handleNew();
          break;
        case 'open':
          handleOpen();
          break;
        case 'save':
          handleSave();
          break;
        case 'save-as':
          handleSaveAs();
          break;
        case 'bold':
          editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          editor.chain().focus().toggleItalic().run();
          break;
        case 'underline':
          editor.chain().focus().toggleUnderline().run();
          break;
        case 'strike':
          editor.chain().focus().toggleStrike().run();
          break;
        case 'code':
          editor.chain().focus().toggleCode().run();
          break;
        case 'code-block':
          editor.chain().focus().toggleCodeBlock().run();
          break;
        case 'blockquote':
          editor.chain().focus().toggleBlockquote().run();
          break;
        case 'horizontal-rule':
          editor.chain().focus().setHorizontalRule().run();
          break;
        case 'add-comment':
          handleAddComment();
          break;
      }
    });

    return unsubscribe;
  }, [editor, handleNew, handleOpen, handleSave, handleSaveAs, handleAddComment]);

  return (
    <div className="flex flex-col h-screen">
      <Toolbar editor={editor} onAddComment={handleAddComment} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto bg-white">
          <div className="max-w-4xl mx-auto">
            <EditorContent editor={editor} className="min-h-full" />
          </div>
        </div>
        {sidebarOpen && (
          <div className="w-80 border-l border-gray-200 bg-white flex flex-col flex-shrink-0">
            <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sidebar</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="p-0.5 hover:bg-gray-200 rounded"
              >
                <X size={14} />
              </button>
            </div>
            <CommentsPanel
              onNavigateToComment={handleNavigateToComment}
              onDeleteComment={handleDeleteComment}
            />
          </div>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
