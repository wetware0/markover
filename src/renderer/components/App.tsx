import React, { useCallback, useEffect } from 'react';
import { EditorContent } from '@tiptap/react';
import { useMarkoverEditor } from '../editor/use-editor';
import { useEditorStore } from '../store/editor-store';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { StatusBar } from '../ui/statusbar/StatusBar';

export function App() {
  const { editor, loadContent, getMarkdown } = useMarkoverEditor();
  const { filePath, setFile, setDirty } = useEditorStore();

  const handleOpen = useCallback(async () => {
    const result = await window.electronAPI.openFile();
    if (result) {
      loadContent(result.content);
      setFile(result.filePath, result.fileName);
    }
  }, [loadContent, setFile]);

  const handleSave = useCallback(async () => {
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
  }, [filePath, getMarkdown, setFile, setDirty]);

  const handleSaveAs = useCallback(async () => {
    const content = getMarkdown();
    const result = await window.electronAPI.saveFileAs(content);
    if (result) {
      setFile(result.filePath, result.filePath.split(/[\\/]/).pop() || 'Untitled');
      setDirty(false);
    }
  }, [getMarkdown, setFile, setDirty]);

  const handleNew = useCallback(() => {
    loadContent('');
    setFile(null, 'Untitled');
  }, [loadContent, setFile]);

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
      }
    });

    return unsubscribe;
  }, [editor, handleNew, handleOpen, handleSave, handleSaveAs]);

  return (
    <div className="flex flex-col h-screen">
      <Toolbar editor={editor} />
      <div className="flex-1 overflow-y-auto bg-white">
        <div className="max-w-4xl mx-auto">
          <EditorContent editor={editor} className="min-h-full" />
        </div>
      </div>
      <StatusBar />
    </div>
  );
}
