import React, { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent } from '@tiptap/react';
import { nanoid } from 'nanoid';
import { useMarkoverEditor } from '../editor/use-editor';
import { useEditorStore } from '../store/editor-store';
import { parseMarkoverFile } from '../../shared/markover-codec';
import { useUserStore, getAuthorName } from '../store/user-store';
import { UserSettingsDialog } from '../ui/UserSettingsDialog';
import { useCommentsStore } from '../collaboration/comments/comment-store';
import { useTrackChangesStore } from '../collaboration/track-changes/track-changes-store';
import { useThemeStore } from '../store/theme-store';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { StatusBar } from '../ui/statusbar/StatusBar';
import { CommentsPanel } from '../collaboration/comments/CommentsPanel';
import { TrackChangesPanel } from '../collaboration/track-changes/TrackChangesPanel';
import { RawEditor } from '../editor/RawEditor';
import { FindReplaceDialog } from '../ui/find-replace/FindReplaceDialog';
import { useFindReplaceStore } from '../store/find-replace-store';
import type { RawSearchHandle } from '../editor/RawEditor';
import { HelpDialog } from '../ui/HelpDialog';
import { AboutDialog } from '../ui/AboutDialog';
import { KatexEditDialog } from '../ui/dialogs/KatexEditDialog';
import { MermaidEditDialog } from '../ui/dialogs/MermaidEditDialog';
import { ImageEditDialog } from '../ui/dialogs/ImageEditDialog';
import { TableContextBar } from '../ui/table/TableContextBar';
import { MessageSquare, GitCompare, X } from 'lucide-react';

type SidebarTab = 'comments' | 'changes';

interface PendingComment {
  from: number;
  to: number;
  commentId: string;
}

export function App() {
  const { editor, loadContent, getMarkdown, getMetadata, setMetadata } = useMarkoverEditor();
  const { filePath, isDirty, setFile, setDirty, isRawMode, setRawMode } = useEditorStore();
  const { setComments, comments, addComment, deleteComment: removeComment } = useCommentsStore();
  const { enabled: trackChangesEnabled, setEnabled: setTrackChangesEnabled, changes, setChanges, removeChange } = useTrackChangesStore();
  const { resolved: resolvedTheme } = useThemeStore();
  const { name: userName, setName } = useUserStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userSettingsOpen, setUserSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('comments');
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null);
  const [commentText, setCommentText] = useState('');
  // Raw editor content — use a ref so CodeMirror doesn't lose cursor on each keystroke
  const rawContentRef = useRef('');
  const rawSearchRef = useRef<RawSearchHandle | null>(null);
  const findReplaceStore = useFindReplaceStore();
  // Pending action waiting for "unsaved changes" confirmation
  const [discardConfirm, setDiscardConfirm] = useState<{ message: string; onProceed: () => void } | null>(null);

  // Node edit state (KaTeX / Mermaid click-to-edit dialogs)
  type NodeEdit =
    | { nodeType: 'katexInline' | 'katexBlock'; math: string; getPos: () => number | undefined }
    | { nodeType: 'mermaidBlock'; code: string; getPos: () => number | undefined }
    | { nodeType: 'image'; src: string; alt: string; width: string; href: string; getPos: () => number | undefined };
  const [nodeEdit, setNodeEdit] = useState<NodeEdit | null>(null);

  // F1 opens help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'F1') { e.preventDefault(); setHelpOpen(true); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Seed author name from OS login on first launch (only if no name persisted)
  useEffect(() => {
    if (!userName.trim()) {
      window.electronAPI.getOsUsername()
        .then((username) => { if (username) setName(username); })
        .catch(() => { /* ignore errors */ });
    }
  }, []); // eslint-disable-line

  // Warn before window close when dirty (main process shows native dialog)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault(); // Triggers will-prevent-unload in main process
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Helper: if dirty, show confirmation dialog before proceeding
  const guardDirty = useCallback((message: string, onProceed: () => void) => {
    if (isDirty) {
      setDiscardConfirm({ message, onProceed });
    } else {
      onProceed();
    }
  }, [isDirty]);

  // Sync user name to comments store and track changes plugin
  useEffect(() => {
    const author = getAuthorName(userName);
    useCommentsStore.getState().setCurrentAuthor(author);
    if (editor) {
      const s = editor.storage.trackChangesPlugin as Record<string, unknown> | undefined;
      if (s) s.author = author;
    }
  }, [userName, editor]);

  // Sync track changes enabled state to the ProseMirror plugin via the
  // persistent editor.storage (editor.extensionStorage), not extension.storage
  // which returns a new object copy on every getter access.
  useEffect(() => {
    if (!editor) return;
    const s = editor.storage.trackChangesPlugin as Record<string, unknown> | undefined;
    if (s) s.enabled = trackChangesEnabled;
  }, [editor, trackChangesEnabled]);

  // Sync comments store → metadata ref before save
  const syncCommentsToMetadata = useCallback(() => {
    const meta = getMetadata();
    meta.comments = comments;
    setMetadata(meta);
  }, [comments, getMetadata, setMetadata]);

  const handleToggleRawMode = useCallback(() => {
    if (!isRawMode) {
      // Switching WYSIWYG → Raw: clear TipTap decorations
      editor?.commands.clearSearch();
      findReplaceStore.clearMatchState();
      // WYSIWYG → Raw: serialize current content
      syncCommentsToMetadata();
      rawContentRef.current = getMarkdown();
      setRawMode(true);
      if (findReplaceStore.isOpen && findReplaceStore.query) {
        setTimeout(() => {
          // Was WYSIWYG, now raw
          rawSearchRef.current?.setQuery(findReplaceStore.query, findReplaceStore.options);
          findReplaceStore.clearMatchState();
        }, 50);
      }
    } else {
      // Switching Raw → WYSIWYG: clear CodeMirror state
      rawSearchRef.current?.setQuery('', findReplaceStore.options);
      findReplaceStore.clearMatchState();
      // Raw → WYSIWYG: parse raw content back into editor
      loadContent(rawContentRef.current);
      setComments(getMetadata().comments);
      setRawMode(false);
      if (findReplaceStore.isOpen && findReplaceStore.query) {
        setTimeout(() => {
          // Was raw, now WYSIWYG
          editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
          findReplaceStore.clearMatchState();
        }, 50);
      }
    }
  }, [isRawMode, getMarkdown, loadContent, getMetadata, setComments, setRawMode, syncCommentsToMetadata, editor, findReplaceStore]);

  const handleSave = useCallback(async () => {
    let content: string;
    if (isRawMode) {
      content = rawContentRef.current;
    } else {
      syncCommentsToMetadata();
      content = getMarkdown();
    }
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
  }, [filePath, isRawMode, getMarkdown, setFile, setDirty, syncCommentsToMetadata]);

  const handleSaveAs = useCallback(async () => {
    let content: string;
    if (isRawMode) {
      content = rawContentRef.current;
    } else {
      syncCommentsToMetadata();
      content = getMarkdown();
    }
    const result = await window.electronAPI.saveFileAs(content);
    if (result) {
      setFile(result.filePath, result.filePath.split(/[\\/]/).pop() || 'Untitled');
      setDirty(false);
    }
  }, [isRawMode, getMarkdown, setFile, setDirty, syncCommentsToMetadata]);

  const handlePublish = useCallback(async () => {
    let rawMd: string;
    if (isRawMode) {
      rawMd = rawContentRef.current;
    } else {
      syncCommentsToMetadata();
      rawMd = getMarkdown();
    }
    // Strip markover comment blocks; extract cspell ignores
    const { cleanMarkdown, metadata } = parseMarkoverFile(rawMd);
    // Accept insertions (keep text), remove comment highlights (keep text)
    let published = cleanMarkdown.replace(
      /<span data-markov="(?:ins|hl)"[^>]*>([\s\S]*?)<\/span>/g,
      '$1',
    );
    // Accept deletions (remove text)
    published = published.replace(/<span data-markov="del"[^>]*>[\s\S]*?<\/span>/g, '');
    // Preserve cspell:ignore words in the published file
    if (metadata.cspellIgnores.length > 0) {
      const deduped = [...new Set(metadata.cspellIgnores)];
      published = `<!-- cspell:ignore ${deduped.join(' ')} -->\n\n` + published;
    }
    await window.electronAPI.saveFileAs(published);
  }, [isRawMode, getMarkdown, syncCommentsToMetadata]);

  const doNew = useCallback(() => {
    if (isRawMode) { rawContentRef.current = ''; setRawMode(false); }
    loadContent('');
    setFile(null, 'Untitled');
    setComments([]);
    setChanges([]);
    editor?.commands.clearSearch();
    findReplaceStore.clearMatchState();
    if (findReplaceStore.isOpen && findReplaceStore.query) {
      setTimeout(() => {
        editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
      }, 50);
    }
  }, [isRawMode, loadContent, setFile, setComments, setChanges, setRawMode, editor, findReplaceStore]);

  const handleNew = useCallback(() => {
    guardDirty('You have unsaved changes. Create a new document anyway?', doNew);
  }, [guardDirty, doNew]);

  // Add comment to selected text — opens an inline dialog instead of window.prompt()
  const handleAddComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    setPendingComment({ from, to, commentId: nanoid(8) });
    setCommentText('');
  }, [editor]);

  const handleSubmitComment = useCallback(() => {
    if (!editor || !pendingComment || !commentText.trim()) return;
    const { from, to, commentId } = pendingComment;
    editor.chain().focus().setTextSelection({ from, to }).setMarkovHighlight({ commentId }).run();
    addComment(commentId, commentText.trim());
    setPendingComment(null);
    setCommentText('');
    setSidebarOpen(true);
    setSidebarTab('comments');
  }, [editor, pendingComment, commentText, addComment]);

  const handleCancelComment = useCallback(() => {
    setPendingComment(null);
    setCommentText('');
    editor?.chain().focus().run();
  }, [editor]);

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
        // Accept deletion: remove the struck-through content entirely
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
        if (positions.length > 0) {
          // If all marked text sits within the same non-paragraph top-level block
          // (table, code block, etc.), delete that whole block node rather than
          // just the text inside it — otherwise an empty shell would be left behind.
          const BLOCK_TYPES = new Set(['table', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'taskList']);
          const topLevelNodes = positions.map((p) => doc.resolve(p.from).node(1));
          const firstTopLevel = topLevelNodes[0];
          const isSingleBlock = topLevelNodes.every((n) => n === firstTopLevel);
          const isBlockDeletion = isSingleBlock && BLOCK_TYPES.has(firstTopLevel.type.name);

          if (isBlockDeletion) {
            const $pos = doc.resolve(positions[0].from);
            tr.delete($pos.before(1), $pos.after(1));
          } else {
            for (let i = positions.length - 1; i >= 0; i--) {
              tr.delete(positions[i].from, positions[i].to);
            }
          }
          editor.view.dispatch(tr);
        }
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

  // Listen for dblclick-to-edit events from KaTeX / Mermaid node views
  useEffect(() => {
    const handler = (e: Event) => {
      setNodeEdit((e as CustomEvent).detail as NodeEdit);
    };
    document.addEventListener('markover:edit-node', handler);
    return () => document.removeEventListener('markover:edit-node', handler);
  }, []);

  // Handle link clicks inside the editor
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    e.preventDefault();

    const isMarkdownFile = /\.(md|markdown|mdown|mkd|mkdn)(\?.*)?$/i.test(href);
    const isExternalUrl = /^https?:\/\//i.test(href);

    if (isMarkdownFile && !isExternalUrl) {
      // Resolve relative paths against the current file's directory
      const currentPath = useEditorStore.getState().filePath;
      let resolved = href;
      if (currentPath && !/^[A-Za-z]:[/\\]/.test(href) && !href.startsWith('/')) {
        const dir = currentPath.replace(/[/\\][^/\\]*$/, '');
        // Normalise the joined path (handle ../ segments) via the URL API
        resolved = new URL(href, `file:///${dir}/`).pathname.replace(/^\/([A-Za-z]:)/, '$1');
      }
      void window.electronAPI.openFilePath(resolved);
    } else {
      void window.electronAPI.openPath(href);
    }
  }, []);

  const handleNodeEditSave = useCallback((newAttrs: Record<string, string>) => {
    if (!nodeEdit || !editor) return;
    const pos = nodeEdit.getPos();
    if (pos === undefined) return;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, newAttrs));
    setNodeEdit(null);
  }, [nodeEdit, editor]);

  // Add cspell ignore words to the session spell checker
  const applyCspellIgnores = useCallback((meta: ReturnType<typeof getMetadata>) => {
    for (const word of meta.cspellIgnores ?? []) {
      window.electronAPI.spellcheckAddWord(word);
    }
  }, []);

  // Handle file opened from main process (recent files, CLI arg, drag-drop)
  useEffect(() => {
    const unsubscribe = window.electronAPI.onFileChanged((data) => {
      const doLoad = () => {
        setRawMode(false);
        rawContentRef.current = '';
        loadContent(data.content);
        setFile(data.filePath, data.fileName);
        const meta = getMetadata();
        setComments(meta.comments);
        applyCspellIgnores(meta);
        editor?.commands.clearSearch();
        findReplaceStore.clearMatchState();
        if (findReplaceStore.isOpen && findReplaceStore.query) {
          setTimeout(() => {
            editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
          }, 50);
        }
      };
      guardDirty(`You have unsaved changes. Open "${data.fileName}" anyway?`, doLoad);
    });
    return unsubscribe;
  }, [loadContent, setFile, getMetadata, setComments, setRawMode, applyCspellIgnores, guardDirty]);

  // Handle menu actions
  useEffect(() => {
    const unsubscribe = window.electronAPI.onMenuAction(async (action: string) => {
      switch (action) {
        case 'new': handleNew(); break;
        case 'open': {
          const doOpen = async () => {
            const data = await window.electronAPI.openFile();
            if (data) {
              setRawMode(false);
              rawContentRef.current = '';
              loadContent(data.content);
              setFile(data.filePath, data.fileName);
              const meta = getMetadata();
              setComments(meta.comments);
              applyCspellIgnores(meta);
              editor?.commands.clearSearch();
              findReplaceStore.clearMatchState();
              if (findReplaceStore.isOpen && findReplaceStore.query) {
                setTimeout(() => {
                  editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
                }, 50);
              }
            }
          };
          guardDirty('You have unsaved changes. Open a different file anyway?', () => { void doOpen(); });
          break;
        }
        case 'save-and-close':
          await handleSave();
          window.electronAPI.confirmClose();
          break;
        case 'save': handleSave(); break;
        case 'save-as': handleSaveAs(); break;
        case 'toggle-raw': handleToggleRawMode(); break;
        // Formatting actions only apply in WYSIWYG mode
        case 'bold': if (!isRawMode && editor) editor.chain().focus().toggleBold().run(); break;
        case 'italic': if (!isRawMode && editor) editor.chain().focus().toggleItalic().run(); break;
        case 'underline': if (!isRawMode && editor) editor.chain().focus().toggleUnderline().run(); break;
        case 'strike': if (!isRawMode && editor) editor.chain().focus().toggleStrike().run(); break;
        case 'code': if (!isRawMode && editor) editor.chain().focus().toggleCode().run(); break;
        case 'code-block': if (!isRawMode && editor) editor.chain().focus().toggleCodeBlock().run(); break;
        case 'blockquote': if (!isRawMode && editor) editor.chain().focus().toggleBlockquote().run(); break;
        case 'horizontal-rule': if (!isRawMode && editor) editor.chain().focus().setHorizontalRule().run(); break;
        case 'add-comment': if (!isRawMode) handleAddComment(); break;
        case 'toggle-track-changes': {
          if (!isRawMode) {
            const next = !trackChangesEnabled;
            setTrackChangesEnabled(next);
            if (next) { setSidebarOpen(true); setSidebarTab('changes'); }
          }
          break;
        }
        case 'find-open': {
          const sel = editor?.state.selection;
          const prefill =
            sel && !sel.empty
              ? editor?.state.doc.textBetween(sel.from, sel.to, ' ')
              : undefined;
          findReplaceStore.open('find', prefill);
          break;
        }
        case 'replace-open': {
          const sel = editor?.state.selection;
          const prefill =
            sel && !sel.empty
              ? editor?.state.doc.textBetween(sel.from, sel.to, ' ')
              : undefined;
          findReplaceStore.open('replace', prefill);
          break;
        }
        case 'publish': handlePublish(); break;
        case 'help': setHelpOpen(true); break;
        case 'about': setAboutOpen(true); break;
        default:
          if (action.startsWith('cspell-ignore:')) {
            const word = action.slice('cspell-ignore:'.length);
            const meta = getMetadata();
            if (!meta.cspellIgnores.includes(word)) {
              meta.cspellIgnores.push(word);
              setMetadata(meta);
            }
            window.electronAPI.spellcheckAddWord(word);
            setDirty(true);
          }
          break;
        case 'print':
          // Switch to WYSIWYG first so TipTap's rendered view is printed
          if (isRawMode) handleToggleRawMode();
          window.electronAPI.print();
          break;
        case 'export-pdf':
          if (isRawMode) handleToggleRawMode();
          window.electronAPI.exportPdf();
          break;
      }
    });
    return unsubscribe;
  }, [editor, isRawMode, handleNew, handleSave, handleSaveAs, handlePublish, handleToggleRawMode, handleAddComment, trackChangesEnabled, setTrackChangesEnabled]);

  return (
    <div className="flex flex-col h-screen print:h-auto print:overflow-visible bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Toolbar
        editor={editor}
        isRawMode={isRawMode}
        onToggleRawMode={handleToggleRawMode}
        onAddComment={handleAddComment}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        trackChangesEnabled={trackChangesEnabled}
        onToggleTrackChanges={() => {
          const next = !trackChangesEnabled;
          setTrackChangesEnabled(next);
          if (next) { setSidebarOpen(true); setSidebarTab('changes'); }
        }}
        onOpenUserSettings={() => setUserSettingsOpen(true)}
      />
      {!isRawMode && editor && <div className="print:hidden"><TableContextBar editor={editor} /></div>}
      <div className="flex flex-1 overflow-hidden print:block print:overflow-visible">
        {isRawMode ? (
          <RawEditor
            value={rawContentRef.current}
            onChange={(v) => { rawContentRef.current = v; setDirty(true); }}
            isDark={resolvedTheme === 'dark'}
            searchRef={rawSearchRef}
          />
        ) : (
        <div className="flex-1 overflow-y-auto print:overflow-visible bg-white dark:bg-gray-900" onClick={handleEditorClick}>
          <div className="max-w-4xl mx-auto">
            <EditorContent editor={editor} className="min-h-full" />
          </div>
        </div>
        )}
        {!isRawMode && sidebarOpen && (
          <div className="w-80 border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col flex-shrink-0 print:hidden">
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

      {/* Find / Replace dialog */}
      <FindReplaceDialog editor={editor} searchRef={rawSearchRef} />

      {/* Help / user guide */}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}

      {/* About dialog */}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}

      {/* Unsaved changes confirmation */}
      {discardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-2">Unsaved Changes</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{discardConfirm.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDiscardConfirm(null)}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { discardConfirm.onProceed(); setDiscardConfirm(null); }}
                className="px-3 py-1.5 text-sm text-red-600 border border-red-300 hover:bg-red-50 dark:hover:bg-red-950 rounded"
              >
                Discard Changes
              </button>
              <button
                type="button"
                onClick={async () => { await handleSave(); discardConfirm.onProceed(); setDiscardConfirm(null); }}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* User identity dialog */}
      {userSettingsOpen && <UserSettingsDialog onClose={() => setUserSettingsOpen(false)} />}

      {/* KaTeX / Mermaid edit dialogs */}
      {nodeEdit && (nodeEdit.nodeType === 'katexInline' || nodeEdit.nodeType === 'katexBlock') && (
        <KatexEditDialog
          math={nodeEdit.math}
          displayMode={nodeEdit.nodeType === 'katexBlock'}
          onSave={(math) => handleNodeEditSave({ math })}
          onCancel={() => setNodeEdit(null)}
        />
      )}
      {nodeEdit && nodeEdit.nodeType === 'mermaidBlock' && (
        <MermaidEditDialog
          code={nodeEdit.code}
          onSave={(code) => handleNodeEditSave({ code })}
          onCancel={() => setNodeEdit(null)}
        />
      )}
      {nodeEdit && nodeEdit.nodeType === 'image' && (
        <ImageEditDialog
          src={nodeEdit.src}
          alt={nodeEdit.alt}
          width={nodeEdit.width}
          href={nodeEdit.href}
          onSave={(attrs) => handleNodeEditSave(attrs)}
          onCancel={() => setNodeEdit(null)}
        />
      )}

      {/* Inline comment dialog — replaces window.prompt() which is unreliable in Electron */}
      {pendingComment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-96 border border-gray-200 dark:border-gray-700">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">Add Comment</h3>
            <textarea
              autoFocus
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); }
                if (e.key === 'Escape') handleCancelComment();
              }}
              placeholder="Write a comment…"
              rows={3}
              className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                type="button"
                onClick={handleCancelComment}
                className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitComment}
                disabled={!commentText.trim()}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Add Comment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
