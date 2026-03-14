import { useEditor as useTipTapEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { MarkoverImage } from './extensions/image-editable';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Highlight from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { useEditorStore } from '../store/editor-store';
import { useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/core';
import { markdownToHtml } from './markdown/parser';
import { prosemirrorToMarkdown } from './markdown/serializer';
import { parseMarkoverFile, serializeMarkoverFile } from '../../shared/markover-codec';
import type { MarkovMetadata } from '../../shared/markover-codec';
import { KatexInline } from './extensions/katex-inline';
import { KatexBlock } from './extensions/katex-block';
import { MermaidBlock } from './extensions/mermaid-block';
import { FootnoteRef, FootnoteBlock } from './extensions/footnote';
import { FrontMatter } from './extensions/front-matter';
import { ImageDrop } from './extensions/image-drop';
import { MarkovHighlight } from './extensions/markover-highlight';
import { MarkovInsert } from './extensions/markover-insert';
import { MarkovDelete } from './extensions/markover-delete';
import { TrackChangesPlugin } from './extensions/track-changes-plugin';

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function useMarkoverEditor() {
  const { setWordCount, setCursor, setDirty } = useEditorStore();
  const isLoadingRef = useRef(false);
  const metadataRef = useRef<MarkovMetadata>({
    highlights: [],
    comments: [],
    insertions: [],
    deletions: [],
    fileMeta: null,
  });

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
      MarkoverImage,
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      KatexInline,
      KatexBlock,
      MermaidBlock,
      FootnoteRef,
      FootnoteBlock,
      FrontMatter,
      ImageDrop,
      MarkovHighlight,
      MarkovInsert,
      MarkovDelete,
      TrackChangesPlugin,
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
    (rawMarkdown: string) => {
      if (!editor) return;
      isLoadingRef.current = true;

      // Temporarily disable track changes so the plugin doesn't treat the
      // entire setContent transaction as a user insertion and mark everything green.
      const tcStorage = editor.storage.trackChangesPlugin as Record<string, unknown> | undefined;
      const tcWasEnabled = tcStorage?.enabled;
      if (tcStorage) tcStorage.enabled = false;

      // Parse out markover metadata, get clean markdown
      const { cleanMarkdown, metadata } = parseMarkoverFile(rawMarkdown);
      metadataRef.current = metadata;

      const html = markdownToHtml(cleanMarkdown);
      editor.commands.setContent(html);

      if (tcStorage) tcStorage.enabled = tcWasEnabled;
      isLoadingRef.current = false;
      setDirty(false);
    },
    [editor, setDirty],
  );

  const getMarkdown = useCallback((): string => {
    if (!editor) return '';
    const cleanMarkdown = prosemirrorToMarkdown(editor.state.doc);
    // Re-inject metadata into the markdown
    return serializeMarkoverFile(cleanMarkdown, metadataRef.current);
  }, [editor]);

  const getMetadata = useCallback(() => metadataRef.current, []);

  const setMetadata = useCallback((metadata: MarkovMetadata) => {
    metadataRef.current = metadata;
  }, []);

  return { editor, loadContent, getMarkdown, getMetadata, setMetadata };
}
