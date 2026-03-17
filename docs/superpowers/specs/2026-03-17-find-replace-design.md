# Find & Replace Design Spec

**Date:** 2026-03-17
**Feature:** Find (Ctrl+F) and Find & Replace (Ctrl+H)
**Status:** Approved for implementation

---

## Overview

Add a rich Find and Find & Replace capability to Markover. The feature is a floating, non-modal dialog that works in both WYSIWYG (TipTap) and Raw (CodeMirror) modes, with context-aware scoping in WYSIWYG mode and full compatibility with the track-changes system.

---

## Architecture

Three layers:

### 1. ProseMirror Plugin — `find-replace-plugin.ts`
**Location:** `src/renderer/editor/extensions/find-replace-plugin.ts`

Owns all search state: query string, replace string, options (case-sensitive, whole word, regex, wrap), current match index, and match list. Uses `DecorationSet` to highlight matches — current match in accent colour, others in a soft tint.

**Exposed commands:**
- `setQuery(query, options)` — debounced 100ms; rebuilds match list and decorations
- `findNext()` / `findPrev()` — advance match index, update decorations
- `replace(replacement)` — replace current match; respects track-changes if enabled
- `replaceAll(replacement)` — batch-replace all matches in one transaction; respects track-changes if enabled
- `clearSearch()` — clear decorations and reset state

**Context-scoping logic:**

At query time, check the node type at the current cursor position:

- **Normal text context** (default): walk all text nodes in the document (including table cell text). Skip any range covered by a `MarkovDelete` mark.

- **Mermaid context** (cursor inside a `mermaidBlock` node): `mermaidBlock` is an atom node — its content is stored entirely in the `code` node attribute, not as ProseMirror text children. Search is performed by string/regex matching against the `code` attribute of each `mermaidBlock` node in the document. A match highlights the entire atom node using `Decoration.node()` around it (not a character-range decoration inside it). Navigation cycles through matching Mermaid nodes. Replace rewrites the `code` attribute value.

- **Math context** (cursor inside a `katexBlock` or `katexInline` node): same approach as Mermaid — match against the `math` attribute, highlight the whole atom node with `Decoration.node()`, replace rewrites the attribute. `katexInline` and `katexBlock` are treated as the same scope.

In atom-node scopes, the match count reflects the number of matching nodes (not character positions). The status line reads e.g. `"2 of 5 Mermaid blocks match"`.

**Match filtering for text context:**
- Skip any text range covered by a `MarkovDelete` mark — deleted text is not searchable
- Text covered by `MarkovInsert` marks is included — it is live content

**Track-changes compatibility:**
- Before dispatching a replace transaction, check `useTrackChangesStore.getState().enabled`
- If track changes is **off**: dispatch a plain `tr.replaceWith()` transaction
- If track changes is **on**:
  - Apply a `MarkovDelete` mark to the matched range and insert the replacement text with a `MarkovInsert` mark
  - Author for both marks comes from `editor.storage.trackChangesPlugin.author` (not from the Zustand store directly) to stay consistent with how existing tracked changes are attributed
  - The dispatched transaction **must** set `tr.setMeta('trackChangesProcessed', true)` to prevent the existing `TrackChangesPlugin` `appendTransaction` hook from double-wrapping the replacement
- `replaceAll` with track changes **on**: batch all mark operations into one transaction; account for position drift by processing matches in **reverse document order** (largest position first), so earlier positions remain valid as the document grows with each tracked replace (same pattern as `insertionOffset` in `track-changes-plugin.ts`)
- `replaceAll` with track changes **off**: process in reverse order too, since the document shrinks/grows with each replacement

### 2. TipTap Extension — `find-replace-extension.ts`
**Location:** `src/renderer/editor/extensions/find-replace-extension.ts`

A thin TipTap `Extension` wrapper that registers the ProseMirror plugin and re-exports its commands as TipTap editor commands callable from the dialog.

### 3. Find/Replace Dialog — `FindReplaceDialog.tsx`
**Location:** `src/renderer/ui/find-replace/FindReplaceDialog.tsx`

Floating React dialog. Non-modal (editor stays interactive). Draggable by title bar. Remembers last screen position. Closed with Escape or the × button.

Reads `isRawMode` from `editor-store`. When in WYSIWYG mode, calls TipTap commands. When in Raw mode, drives CodeMirror's search API via a `searchRef` exposed from `RawEditor`.

### 4. Zustand Store — `find-replace-store.ts`
**Location:** `src/renderer/store/find-replace-store.ts`

Holds:
- `isOpen: boolean`
- `activeTab: 'find' | 'replace'`
- `query: string`
- `replacement: string`
- `options: { matchCase, wholeWord, regex, wrap, inSelection }`
- `matchCount: number`
- `currentMatchIndex: number`
- `scopeLabel: string | null` — e.g. `"Mermaid"` or `"Math"` when context-scoped; `null` otherwise
- `regexError: string | null`
- `statusMessage: string | null` — transient message e.g. `"Replaced 5 occurrences"`; cleared when the query changes or on the next findNext/findPrev call
- `findHistory: string[]` — last 10 find queries (FIFO, deduplicated: re-entering an existing entry moves it to the top)
- `replaceHistory: string[]` — last 10 replace strings (same policy)

Find and replace histories are persisted to localStorage under `markover-find-history` and `markover-replace-history`.

---

## UI

### Layout

```
┌─ Find & Replace ─────────────────────────────────────[×]┐
│  [Find]  [Replace]                                       │
├──────────────────────────────────────────────────────────┤
│  Find:    [_________________________________▼]           │
│           (regex error shown here if applicable)         │
│                                                          │
│  ☐ Match case   ☐ Whole word   ☐ Regex   ☑ Wrap         │
│                                                          │
│  Status: "3 of 12 matches · Searching in: Mermaid"       │
│                                                          │
│            [Find Prev]  [Find Next]          [Close]     │
└──────────────────────────────────────────────────────────┘
```

Replace tab adds:

```
│  Replace: [_________________________________▼]  [⇅]     │
│                                                          │
│  [Replace]   [Replace All]   ☐ In selection             │
```

### Behaviour Details

- **Find/Replace inputs** have dropdown history (last 10 entries each, from localStorage). History entries are deduplicated: re-entering an existing value moves it to the top. FIFO when the list exceeds 10.
- **`⇅` swap button** swaps the find and replace field contents
- **Status line** shows:
  - `"3 of 12 matches"` — normal text search
  - `"2 of 5 Mermaid blocks match"` — Mermaid context
  - `"1 of 3 Math blocks match"` — Math context
  - `"3 of 12 matches · Searching in: Mermaid"` when relevant to add context label alongside count
  - `"No matches"` (red) — no results
  - `"Replaced 5 occurrences"` — after replaceAll; clears on next query change or findNext/findPrev call
- **Current match**: distinct accent highlight (blue border + background tint)
- **Other matches**: soft background tint
- **`In selection`** checkbox:
  - Enabled only when an active non-collapsed selection exists in the editor at the time the checkbox is ticked
  - The selection range is captured and frozen at that moment; subsequent cursor movement does not change the search scope until the checkbox is unticked and re-ticked
  - Mutually exclusive with context-scoping (Mermaid/Math): if the cursor is in an atom-node context, `In selection` is disabled and greyed out
  - For `replaceAll` with `inSelection`, match positions are processed in reverse document order to avoid offset drift
- **Regex error**: shown as red text directly below the Find input; Find Next/Replace buttons disabled while error exists
- **Escape**: closes dialog and clears decorations

### Keyboard Shortcuts Inside Dialog

| Key | Action |
|-----|--------|
| `Enter` / `F3` | Find Next |
| `Shift+Enter` / `Shift+F3` | Find Prev |
| `Escape` | Close dialog |

Note: `Ctrl+H` and `Ctrl+F` open or switch the dialog tabs when pressed in the editor (via Electron menu action). When focus is already inside the dialog, those keys are not re-handled — they bubble normally.

---

## Keyboard Shortcut Registration

- `Ctrl+F` / `Cmd+F`: Open dialog on Find tab (or bring to front / switch to Find tab if already open)
- `Ctrl+H` / `Cmd+H`: Open dialog on Replace tab (or bring to front / switch to Replace tab if already open)
- Both registered as Electron menu items in `menu.ts` with `MENU_ACTION` IPC dispatch
- App.tsx listens for these menu actions and dispatches to `find-replace-store`
- If text is selected in the editor when `Ctrl+F` / `Ctrl+H` is pressed, the selection text pre-fills the Find input and a new search is triggered immediately

---

## CodeMirror Integration (Raw Mode)

`RawEditor.tsx` currently uses `@uiw/react-codemirror`. The integration works as follows:

1. Add `@codemirror/search` extensions to the `extensions` array in `RawEditor` at instantiation (required for the search commands to work)
2. Obtain the underlying `EditorView` instance via the ref callback provided by `@uiw/react-codemirror` (`ref.current.view`)
3. Expose a `searchRef` prop (`React.MutableRefObject<RawSearchHandle | null>`) from `RawEditor` that `FindReplaceDialog` populates

```ts
interface RawSearchHandle {
  setQuery(query: string, options: SearchOptions): void
  findNext(): void
  findPrev(): void
  replace(replacement: string): void
  replaceAll(replacement: string): void
  getMatchInfo(): { current: number; total: number }
}
```

Backed by `SearchQuery`, `findNext`, `findPrev`, `replaceNext`, `replaceAll` from `@codemirror/search`, applied via `view.dispatch`. `FindReplaceDialog` selects the correct backend at runtime based on `isRawMode`.

Track-changes is only available in WYSIWYG mode, so the CodeMirror path always uses plain replacement.

---

## Lifecycle Interactions

### File saved while dialog is open
The dialog stays open. Search state is unaffected. The `"Replaced N occurrences"` status message (if showing) clears naturally on the next query change or navigation action.

### New file loaded while dialog is open
When `loadContent()` is called (triggered by `onFileChanged`, new file, or open file):
- `EditorState.create(...)` reinitialises all ProseMirror plugin state, wiping match list and decorations
- `App.tsx` must call `clearSearch()` on the editor and reset `find-replace-store` match counts (`matchCount: 0`, `currentMatchIndex: 0`, `statusMessage: null`) after the new content is loaded
- If the dialog is open and the query is non-empty, re-issue `setQuery` against the new document immediately so the match list reflects the new content

### Mode toggled (WYSIWYG ↔ Raw) while dialog is open
- **WYSIWYG → Raw**: Call `clearSearch()` on the TipTap editor to remove all ProseMirror decorations before the switch. Then re-issue the current query (if non-empty) to the CodeMirror backend, resetting `currentMatchIndex` to 0.
- **Raw → WYSIWYG**: Clear CodeMirror search state. `handleToggleRawMode` in `App.tsx` calls `loadContent()` which reinitialises ProseMirror state — after that completes, re-issue the current query to the TipTap backend, resetting `currentMatchIndex` to 0.
- Match counts will differ between backends (different text representations) — this is expected and the UI updates accordingly.

---

## Track Changes Compatibility

| Scenario | Behaviour |
|----------|-----------|
| Track changes off | `replace`/`replaceAll` dispatch plain `tr.replaceWith()` |
| Track changes on, replace | Apply `MarkovDelete` mark to matched range + insert replacement with `MarkovInsert` mark (author from `editor.storage.trackChangesPlugin.author`); transaction carries `trackChangesProcessed: true` meta |
| Track changes on, replaceAll | All mark operations batched into one transaction; matches processed in reverse document order to avoid position drift |
| Track changes off, replaceAll | Matches also processed in reverse document order |
| Searching deleted text | Ranges covered by `MarkovDelete` are skipped in the match-list walker |
| Searching inserted text | Ranges covered by `MarkovInsert` are included normally |

---

## Files Added / Modified

| File | Action |
|------|--------|
| `src/renderer/editor/extensions/find-replace-plugin.ts` | New — ProseMirror plugin |
| `src/renderer/editor/extensions/find-replace-extension.ts` | New — TipTap extension wrapper |
| `src/renderer/store/find-replace-store.ts` | New — Zustand store |
| `src/renderer/ui/find-replace/FindReplaceDialog.tsx` | New — floating dialog component |
| `src/renderer/editor/use-editor.ts` | Modified — register FindReplace extension |
| `src/renderer/editor/RawEditor.tsx` | Modified — add `@codemirror/search` to extensions; expose `searchRef` |
| `src/renderer/components/App.tsx` | Modified — render dialog, handle menu actions, pass searchRef, handle lifecycle resets |
| `src/main/menu.ts` | Modified — add Find and Replace menu items |
| `src/shared/types/ipc.ts` | Modified — add `FIND_OPEN` and `REPLACE_OPEN` menu action constants |

---

## Out of Scope

- Find in Files / Find in Projects (single-document editor)
- Mark tab (highlight all with colour)
- Extended search mode (`\n`, `\r`, `\t` escape sequences) — regex mode covers advanced cases
- Transparency / opacity controls
