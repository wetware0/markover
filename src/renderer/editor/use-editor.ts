import { useEditor as useTipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { useEditorStore } from '../store/editor-store';
import { useCallback, useEffect, useRef } from 'react';
import type { Editor } from '@tiptap/core';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function useMarkoverEditor() {
  const { setWordCount, setCursor, setDirty } = useEditorStore();
  const isLoadingRef = useRef(false);

  const updateStats = useCallback(
    (editor: Editor) => {
      const text = editor.state.doc.textContent;
      const words = countWords(text);
      const chars = text.length;
      const lines = editor.state.doc.content.childCount;
      setWordCount(words, chars, lines);

      const { from } = editor.state.selection;
      const resolved = editor.state.doc.resolve(from);
      const line = resolved.depth > 0 ? resolved.index(0) + 1 : 1;
      const parentOffset = resolved.parentOffset;
      setCursor(line, parentOffset + 1);
    },
    [setWordCount, setCursor],
  );

  const editor = useTipTapEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        codeBlock: { HTMLAttributes: { class: 'hljs' } },
      }),
      Underline,
      Placeholder.configure({ placeholder: 'Start writing…' }),
      Link.configure({ openOnClick: false, autolink: true }),
      Image,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: '',
    onUpdate: ({ editor }) => {
      updateStats(editor);
      if (!isLoadingRef.current) {
        setDirty(true);
      }
    },
    onSelectionUpdate: ({ editor }) => {
      updateStats(editor);
    },
    onCreate: ({ editor }) => {
      updateStats(editor);
    },
  });

  const loadContent = useCallback(
    (content: string) => {
      if (!editor) return;
      isLoadingRef.current = true;
      editor.commands.setContent(content);
      isLoadingRef.current = false;
      setDirty(false);
    },
    [editor, setDirty],
  );

  const getMarkdown = useCallback((): string => {
    if (!editor) return '';
    // For Phase 1, we serialize as HTML. Phase 3 will add proper markdown serialization.
    return editor.getHTML();
  }, [editor]);

  return { editor, loadContent, getMarkdown };
}
