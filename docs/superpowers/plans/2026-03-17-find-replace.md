# Find & Replace Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating Find & Replace dialog (Ctrl+F / Ctrl+H) to Markover with regex, whole-word, case-sensitive search, context-scoping for Mermaid/KaTeX atom nodes, and full track-changes compatibility.

**Architecture:** A ProseMirror decoration plugin owns all search state and renders match highlights; a thin TipTap Extension wraps it and exposes editor commands; a Zustand store holds dialog UI state; a floating React dialog drives both TipTap (WYSIWYG) and CodeMirror (Raw) through a unified interface.

**Tech Stack:** TypeScript, TipTap 3 / ProseMirror, Zustand, React 19, Tailwind CSS 4, `@codemirror/search`, Electron IPC, nanoid

---

## File Map

| File | Action |
|------|--------|
| `src/shared/types/ipc.ts` | Modify — add `FIND_OPEN`, `REPLACE_OPEN` menu action constants |
| `src/main/menu.ts` | Modify — add Find / Replace items to Edit menu |
| `src/renderer/store/find-replace-store.ts` | **Create** — Zustand store for dialog UI state |
| `src/renderer/editor/extensions/find-replace-plugin.ts` | **Create** — ProseMirror plugin (decoration, match building, commands) |
| `src/renderer/editor/extensions/find-replace-extension.ts` | **Create** — TipTap Extension wrapping the plugin |
| `src/renderer/editor/use-editor.ts` | Modify — register FindReplaceExtension |
| `src/renderer/editor/RawEditor.tsx` | Modify — add `@codemirror/search`, expose `searchRef` |
| `src/renderer/ui/find-replace/FindReplaceDialog.tsx` | **Create** — floating dialog component |
| `src/renderer/components/App.tsx` | Modify — render dialog, handle menu actions, lifecycle resets |

---

## Task 1: IPC constants and menu items

**Files:**
- Modify: `src/shared/types/ipc.ts`
- Modify: `src/main/menu.ts`

- [ ] **Step 1: Add FIND_OPEN and REPLACE_OPEN to IPC_CHANNELS**

In `src/shared/types/ipc.ts`, add to the `IPC_CHANNELS` object (after `MENU_ACTION`):

```typescript
  FIND_OPEN: 'menu:find-open',
  REPLACE_OPEN: 'menu:replace-open',
```

- [ ] **Step 2: Add Find and Replace to the Edit menu**

In `src/main/menu.ts`, replace the Edit submenu with:

```typescript
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendAction('find-open'),
        },
        {
          label: 'Replace...',
          accelerator: 'CmdOrCtrl+H',
          click: () => sendAction('replace-open'),
        },
      ],
    },
```

**Important:** the existing Edit submenu already has `{ type: 'separator' }` between redo and cut. The snippet above preserves it — make sure not to drop it when editing.

- [ ] **Step 3: Verify — run `npm start`, open Edit menu, confirm Find and Replace items appear with correct accelerators**

- [ ] **Step 4: Commit**

```bash
git add src/shared/types/ipc.ts src/main/menu.ts
git commit -m "feat: add Find and Replace menu items with Ctrl+F / Ctrl+H shortcuts"
```

---

## Task 2: Zustand store

**Files:**
- Create: `src/renderer/store/find-replace-store.ts`

- [ ] **Step 1: Create the store**

```typescript
// src/renderer/store/find-replace-store.ts
import { create } from 'zustand';

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  wrap: boolean;
  inSelection: boolean;
  selectionFrom?: number;
  selectionTo?: number;
}

const defaultOptions: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  regex: false,
  wrap: true,
  inSelection: false,
};

function loadHistory(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveHistory(key: string, history: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch {
    // ignore
  }
}

function addToHistory(history: string[], value: string): string[] {
  if (!value.trim()) return history;
  const deduped = history.filter((h) => h !== value);
  const next = [value, ...deduped].slice(0, 10);
  return next;
}

interface FindReplaceState {
  isOpen: boolean;
  activeTab: 'find' | 'replace';
  query: string;
  replacement: string;
  options: SearchOptions;
  matchCount: number;
  currentMatchIndex: number;
  scopeLabel: string | null;
  regexError: string | null;
  statusMessage: string | null;
  findHistory: string[];
  replaceHistory: string[];

  open: (tab?: 'find' | 'replace', prefill?: string) => void;
  close: () => void;
  setActiveTab: (tab: 'find' | 'replace') => void;
  setQuery: (query: string) => void;
  setReplacement: (replacement: string) => void;
  setOption: <K extends keyof SearchOptions>(key: K, value: SearchOptions[K]) => void;
  setMatchInfo: (count: number, index: number, scopeLabel?: string | null) => void;
  setRegexError: (error: string | null) => void;
  setStatusMessage: (message: string | null) => void;
  clearMatchState: () => void;
  pushFindHistory: (query: string) => void;
  pushReplaceHistory: (replacement: string) => void;
}

export const useFindReplaceStore = create<FindReplaceState>((set, get) => ({
  isOpen: false,
  activeTab: 'find',
  query: '',
  replacement: '',
  options: defaultOptions,
  matchCount: 0,
  currentMatchIndex: 0,
  scopeLabel: null,
  regexError: null,
  statusMessage: null,
  findHistory: loadHistory('markover-find-history'),
  replaceHistory: loadHistory('markover-replace-history'),

  open: (tab = 'find', prefill) => {
    const update: Partial<FindReplaceState> = { isOpen: true, activeTab: tab };
    if (prefill !== undefined) update.query = prefill;
    set(update);
  },

  close: () => set({ isOpen: false }),

  setActiveTab: (activeTab) => set({ activeTab }),

  setQuery: (query) => set({ query, statusMessage: null }),

  setReplacement: (replacement) => set({ replacement }),

  setOption: (key, value) =>
    set((s) => ({ options: { ...s.options, [key]: value } })),

  setMatchInfo: (matchCount, currentMatchIndex, scopeLabel = null) =>
    set({ matchCount, currentMatchIndex, scopeLabel }),

  setRegexError: (regexError) => set({ regexError }),

  setStatusMessage: (statusMessage) => set({ statusMessage }),

  clearMatchState: () =>
    set({ matchCount: 0, currentMatchIndex: 0, scopeLabel: null, statusMessage: null }),

  pushFindHistory: (query) => {
    const next = addToHistory(get().findHistory, query);
    saveHistory('markover-find-history', next);
    set({ findHistory: next });
  },

  pushReplaceHistory: (replacement) => {
    const next = addToHistory(get().replaceHistory, replacement);
    saveHistory('markover-replace-history', next);
    set({ replaceHistory: next });
  },
}));
```

- [ ] **Step 2: Verify — run `npm run lint`, confirm no TypeScript errors**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/find-replace-store.ts
git commit -m "feat: add find-replace Zustand store with history persistence"
```

---

## Task 3: ProseMirror plugin

**Files:**
- Create: `src/renderer/editor/extensions/find-replace-plugin.ts`

- [ ] **Step 1: Create the plugin file**

```typescript
// src/renderer/editor/extensions/find-replace-plugin.ts
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorState } from '@tiptap/pm/state';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { SearchOptions } from '../../store/find-replace-store';

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>('findReplace');

export type SearchScope = 'text' | 'mermaid' | 'math';

export interface TextMatch {
  from: number;
  to: number;
}

export interface AtomMatch {
  nodePos: number;
  nodeSize: number;
}

export interface FindReplacePluginState {
  query: string;
  options: SearchOptions;
  matches: TextMatch[];
  atomMatches: AtomMatch[];
  currentIndex: number;
  decorations: DecorationSet;
  scope: SearchScope;
  regexError: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function detectScope(state: EditorState): SearchScope {
  const sel = state.selection;
  // NodeSelection: atom node is explicitly selected
  if (sel instanceof NodeSelection) {
    const name = sel.node.type.name;
    if (name === 'mermaidBlock') return 'mermaid';
    if (name === 'katexBlock' || name === 'katexInline') return 'math';
  }
  // Cursor adjacent to an atom node
  const nodeAt = state.doc.nodeAt(sel.from);
  if (nodeAt) {
    if (nodeAt.type.name === 'mermaidBlock') return 'mermaid';
    if (nodeAt.type.name === 'katexBlock' || nodeAt.type.name === 'katexInline') return 'math';
  }
  return 'text';
}

function buildPattern(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  try {
    const flags = options.matchCase ? 'g' : 'gi';
    if (options.regex) return new RegExp(query, flags);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wb = options.wholeWord ? '\\b' : '';
    return new RegExp(`${wb}${escaped}${wb}`, flags);
  } catch {
    return null;
  }
}

function validateRegex(query: string, options: SearchOptions): string | null {
  if (!options.regex || !query) return null;
  try {
    new RegExp(query);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

function buildTextMatches(doc: PmNode, query: string, options: SearchOptions): TextMatch[] {
  const pattern = buildPattern(query, options);
  if (!pattern) return [];
  const matches: TextMatch[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === 'markovDelete')) return;

    const text = node.text;
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      const from = pos + m.index;
      const to = from + m[0].length;
      if (options.inSelection && options.selectionFrom !== undefined && options.selectionTo !== undefined) {
        if (from < options.selectionFrom || to > options.selectionTo) {
          if (m[0].length === 0) pattern.lastIndex++;
          continue;
        }
      }
      matches.push({ from, to });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  });

  return matches;
}

function buildAtomMatches(doc: PmNode, query: string, options: SearchOptions, scope: 'mermaid' | 'math'): AtomMatch[] {
  const pattern = buildPattern(query, { ...options, regex: options.regex });
  if (!pattern) return [];
  const nodeTypes = scope === 'mermaid' ? ['mermaidBlock'] : ['katexBlock', 'katexInline'];
  const attr = scope === 'mermaid' ? 'code' : 'math';
  const matches: AtomMatch[] = [];

  doc.descendants((node, pos) => {
    if (!nodeTypes.includes(node.type.name)) return;
    const value = (node.attrs[attr] as string) ?? '';
    // Reset flags for non-global test
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      matches.push({ nodePos: pos, nodeSize: node.nodeSize });
    }
  });

  return matches;
}

function buildDecorations(
  doc: PmNode,
  matches: TextMatch[],
  atomMatches: AtomMatch[],
  currentIndex: number,
  scope: SearchScope,
): DecorationSet {
  const decos: Decoration[] = [];
  const otherStyle = 'background-color: rgba(253, 224, 71, 0.45);';
  const currentStyle =
    'background-color: rgba(59, 130, 246, 0.35); outline: 1.5px solid #3b82f6; border-radius: 2px;';

  if (scope === 'text') {
    matches.forEach((match, i) => {
      decos.push(
        Decoration.inline(match.from, match.to, {
          style: i === currentIndex ? currentStyle : otherStyle,
          class: i === currentIndex ? 'find-match-current' : 'find-match',
        }),
      );
    });
  } else {
    atomMatches.forEach((match, i) => {
      decos.push(
        Decoration.node(match.nodePos, match.nodePos + match.nodeSize, {
          style: i === currentIndex ? currentStyle : otherStyle,
          class: i === currentIndex ? 'find-match-current' : 'find-match',
        }),
      );
    });
  }

  return DecorationSet.create(doc, decos);
}

// ── Plugin ───────────────────────────────────────────────────────────────────

const defaultState: FindReplacePluginState = {
  query: '',
  options: { matchCase: false, wholeWord: false, regex: false, wrap: true, inSelection: false },
  matches: [],
  atomMatches: [],
  currentIndex: 0,
  decorations: DecorationSet.empty,
  scope: 'text',
  regexError: null,
};

export function createFindReplacePlugin(): Plugin {
  return new Plugin<FindReplacePluginState>({
    key: findReplacePluginKey,

    state: {
      init(): FindReplacePluginState {
        return { ...defaultState };
      },

      apply(tr, value, _oldState, newState): FindReplacePluginState {
        const meta = tr.getMeta(findReplacePluginKey) as
          | { type: 'setQuery'; query: string; options: SearchOptions; scope: SearchScope }
          | { type: 'setIndex'; index: number }
          | { type: 'clear' }
          | undefined;

        if (meta?.type === 'clear') {
          return { ...defaultState };
        }

        if (meta?.type === 'setQuery') {
          const { query, options, scope } = meta;
          const regexError = validateRegex(query, options);
          if (regexError) {
            return { ...value, query, options, scope, regexError, matches: [], atomMatches: [], currentIndex: 0, decorations: DecorationSet.empty };
          }
          const matches = scope === 'text' ? buildTextMatches(newState.doc, query, options) : [];
          const atomMatches = scope !== 'text' ? buildAtomMatches(newState.doc, query, options, scope) : [];
          const decorations = buildDecorations(newState.doc, matches, atomMatches, 0, scope);
          return { query, options, scope, matches, atomMatches, currentIndex: 0, decorations, regexError: null };
        }

        if (meta?.type === 'setIndex') {
          const index = meta.index;
          const decorations = buildDecorations(newState.doc, value.matches, value.atomMatches, index, value.scope);
          return { ...value, currentIndex: index, decorations };
        }

        // Rebuild on document change if a query is active
        if (tr.docChanged && value.query) {
          const { query, options, scope } = value;
          const matches = scope === 'text' ? buildTextMatches(newState.doc, query, options) : [];
          const atomMatches = scope !== 'text' ? buildAtomMatches(newState.doc, query, options, scope) : [];
          const list = scope === 'text' ? matches : atomMatches;
          const newIndex = Math.min(value.currentIndex, Math.max(0, list.length - 1));
          const decorations = buildDecorations(newState.doc, matches, atomMatches, newIndex, scope);
          return { ...value, matches, atomMatches, currentIndex: newIndex, decorations };
        }

        if (tr.docChanged) {
          return { ...value, decorations: value.decorations.map(tr.mapping, tr.doc) };
        }

        return value;
      },
    },

    props: {
      decorations(state) {
        return findReplacePluginKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },
  });
}

// ── Public helpers ────────────────────────────────────────────────────────────

export function getPluginState(state: EditorState): FindReplacePluginState | null {
  return findReplacePluginKey.getState(state) ?? null;
}

export { buildTextMatches, buildAtomMatches, buildDecorations, validateRegex };
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/editor/extensions/find-replace-plugin.ts
git commit -m "feat: add find-replace ProseMirror decoration plugin"
```

---

## Task 4: TipTap extension and use-editor registration

**Files:**
- Create: `src/renderer/editor/extensions/find-replace-extension.ts`
- Modify: `src/renderer/editor/use-editor.ts`

- [ ] **Step 1: Create the TipTap extension**

```typescript
// src/renderer/editor/extensions/find-replace-extension.ts
import { Extension } from '@tiptap/core';
import { nanoid } from 'nanoid';
import { createFindReplacePlugin, findReplacePluginKey, detectScope, getPluginState } from './find-replace-plugin';
import { useTrackChangesStore } from '../../collaboration/track-changes/track-changes-store';
import type { SearchOptions } from '../../store/find-replace-store';

export const FindReplaceExtension = Extension.create({
  name: 'findReplace',

  addProseMirrorPlugins() {
    return [createFindReplacePlugin()];
  },

  addCommands() {
    return {
      setSearchQuery:
        (query: string, options: SearchOptions) =>
        ({ state, dispatch }) => {
          const scope = detectScope(state);
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setQuery', query, options, scope }));
          }
          return true;
        },

      findNext:
        () =>
        ({ state, dispatch, view }) => {
          const ps = getPluginState(state);
          if (!ps) return false;
          const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
          if (!list.length) return false;

          let newIndex = ps.currentIndex + 1;
          if (newIndex >= list.length) {
            if (!ps.options.wrap) return false;
            newIndex = 0;
          }

          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setIndex', index: newIndex }));
            setTimeout(() => {
              const el = view?.dom.querySelector('.find-match-current');
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 0);
          }
          return true;
        },

      findPrev:
        () =>
        ({ state, dispatch, view }) => {
          const ps = getPluginState(state);
          if (!ps) return false;
          const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
          if (!list.length) return false;

          let newIndex = ps.currentIndex - 1;
          if (newIndex < 0) {
            if (!ps.options.wrap) return false;
            newIndex = list.length - 1;
          }

          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'setIndex', index: newIndex }));
            setTimeout(() => {
              const el = view?.dom.querySelector('.find-match-current');
              el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }, 0);
          }
          return true;
        },

      replaceMatch:
        (replacement: string) =>
        ({ state, dispatch }) => {
          const ps = getPluginState(state);
          if (!ps || ps.regexError) return false;

          const trackChangesOn = useTrackChangesStore.getState().enabled;

          if (ps.scope === 'text') {
            if (!ps.matches.length) return false;
            const match = ps.matches[ps.currentIndex];
            if (!match) return false;
            const schema = state.schema;
            const { tr } = state;

            if (trackChangesOn) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const author = (this.editor.storage.trackChangesPlugin as any)?.author ?? 'User';
              const date = new Date().toISOString().split('T')[0];
              const insertMark = schema.marks.markovInsert?.create({ changeId: nanoid(8), author, date });
              const deleteMark = schema.marks.markovDelete?.create({ changeId: nanoid(8), author, date });
              tr.setMeta('trackChangesProcessed', true);
              if (replacement && insertMark) {
                tr.insert(match.from, schema.text(replacement, [insertMark]));
              }
              if (deleteMark) {
                const delFrom = match.from + replacement.length;
                const delTo = match.to + replacement.length;
                tr.addMark(delFrom, delTo, deleteMark);
              }
            } else {
              if (replacement) {
                tr.replaceWith(match.from, match.to, schema.text(replacement));
              } else {
                tr.delete(match.from, match.to);
              }
            }

            if (dispatch) dispatch(tr);
            return true;
          }

          // Atom node replace
          if (!ps.atomMatches.length) return false;
          const atomMatch = ps.atomMatches[ps.currentIndex];
          if (!atomMatch) return false;
          const node = state.doc.nodeAt(atomMatch.nodePos);
          if (!node) return false;
          const attr = ps.scope === 'mermaid' ? 'code' : 'math';

          // Build pattern from current query for attribute replace
          let newValue: string;
          try {
            const flags = ps.options.matchCase ? 'g' : 'gi';
            const pat = ps.options.regex
              ? new RegExp(ps.query, flags)
              : new RegExp(
                  (ps.options.wholeWord ? '\\b' : '') +
                    ps.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    (ps.options.wholeWord ? '\\b' : ''),
                  flags,
                );
            newValue = (node.attrs[attr] as string).replace(pat, replacement);
          } catch {
            return false;
          }

          if (dispatch) {
            const { tr } = state;
            tr.setNodeMarkup(atomMatch.nodePos, undefined, { ...node.attrs, [attr]: newValue });
            dispatch(tr);
          }
          return true;
        },

      replaceAll:
        (replacement: string) =>
        ({ state, dispatch }) => {
          const ps = getPluginState(state);
          if (!ps || ps.regexError) return false;

          const trackChangesOn = useTrackChangesStore.getState().enabled;
          const schema = state.schema;
          const { tr } = state;

          if (ps.scope === 'text') {
            if (!ps.matches.length) return false;
            // Process in reverse order to avoid position drift
            const sorted = [...ps.matches].sort((a, b) => b.from - a.from);

            if (trackChangesOn) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const author = (this.editor.storage.trackChangesPlugin as any)?.author ?? 'User';
              const date = new Date().toISOString().split('T')[0];
              tr.setMeta('trackChangesProcessed', true);
              for (const m of sorted) {
                const insertMark = schema.marks.markovInsert?.create({ changeId: nanoid(8), author, date });
                const deleteMark = schema.marks.markovDelete?.create({ changeId: nanoid(8), author, date });
                if (replacement && insertMark) {
                  tr.insert(m.from, schema.text(replacement, [insertMark]));
                }
                if (deleteMark) {
                  tr.addMark(m.from + replacement.length, m.to + replacement.length, deleteMark);
                }
              }
            } else {
              for (const m of sorted) {
                if (replacement) {
                  tr.replaceWith(m.from, m.to, schema.text(replacement));
                } else {
                  tr.delete(m.from, m.to);
                }
              }
            }

            if (dispatch) dispatch(tr);
            return true;
          }

          // Atom nodes — replace attribute value in each matching node
          if (!ps.atomMatches.length) return false;
          let pat: RegExp;
          try {
            const flags = ps.options.matchCase ? 'g' : 'gi';
            pat = ps.options.regex
              ? new RegExp(ps.query, flags)
              : new RegExp(
                  (ps.options.wholeWord ? '\\b' : '') +
                    ps.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
                    (ps.options.wholeWord ? '\\b' : ''),
                  flags,
                );
          } catch {
            return false;
          }

          const attr = ps.scope === 'mermaid' ? 'code' : 'math';
          // Reverse to keep positions stable (atom replacements don't change doc size)
          const sorted2 = [...ps.atomMatches].sort((a, b) => b.nodePos - a.nodePos);
          for (const am of sorted2) {
            const node = state.doc.nodeAt(am.nodePos);
            if (!node) continue;
            const newValue = (node.attrs[attr] as string).replace(pat, replacement);
            tr.setNodeMarkup(am.nodePos, undefined, { ...node.attrs, [attr]: newValue });
          }
          if (dispatch) dispatch(tr);
          return true;
        },

      clearSearch:
        () =>
        ({ state, dispatch }) => {
          if (dispatch) {
            dispatch(state.tr.setMeta(findReplacePluginKey, { type: 'clear' }));
          }
          return true;
        },

      getMatchCount: () => ({ editor }) => {
        const ps = getPluginState(editor.state);
        if (!ps) return { count: 0, index: 0, scope: 'text' as const, regexError: null };
        const list = ps.scope === 'text' ? ps.matches : ps.atomMatches;
        return { count: list.length, index: ps.currentIndex, scope: ps.scope, regexError: ps.regexError };
      },
    };
  },
});
```

- [ ] **Step 2: Register FindReplaceExtension in use-editor.ts**

At the top of `src/renderer/editor/use-editor.ts`, add the import after the existing extension imports:

```typescript
import { FindReplaceExtension } from './extensions/find-replace-extension';
```

Inside the `useTipTapEditor({ extensions: [...] })` call, add `FindReplaceExtension` to the extensions array (anywhere in the list, e.g. after `TrackChangesPlugin`):

```typescript
FindReplaceExtension,
```

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

- [ ] **Step 4: Verify — run `npm start`, open DevTools console, type in editor. No errors should appear.**

- [ ] **Step 5: Commit**

```bash
git add src/renderer/editor/extensions/find-replace-extension.ts src/renderer/editor/use-editor.ts
git commit -m "feat: add FindReplace TipTap extension and register in editor"
```

---

## Task 5: RawEditor CodeMirror integration

**Files:**
- Modify: `src/renderer/editor/RawEditor.tsx`

- [ ] **Step 1: Check if @codemirror/search is available**

```bash
node -e "require('@codemirror/search'); console.log('ok')"
```

If it prints `ok`, skip Step 2. If it errors, install it.

- [ ] **Step 2: Install if needed**

```bash
npm install @codemirror/search
```

- [ ] **Step 3: Rewrite RawEditor.tsx with searchRef support**

```typescript
// src/renderer/editor/RawEditor.tsx
import React, { useRef, useEffect } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView } from '@codemirror/view';
import { SearchQuery, findNext, findPrevious, replaceNext, replaceAll, search } from '@codemirror/search';
import type { SearchOptions } from '../store/find-replace-store';

export interface RawSearchHandle {
  setQuery: (query: string, options: SearchOptions) => void;
  findNext: () => void;
  findPrev: () => void;
  replace: (replacement: string) => void;
  replaceAll: (replacement: string) => void;
  getMatchInfo: () => { current: number; total: number };
}

interface RawEditorProps {
  value: string;
  onChange: (value: string) => void;
  isDark: boolean;
  searchRef?: React.MutableRefObject<RawSearchHandle | null>;
}

export function RawEditor({ value, onChange, isDark, searchRef }: RawEditorProps) {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const currentQueryRef = useRef<{ query: string; options: SearchOptions } | null>(null);

  useEffect(() => {
    if (!searchRef) return;
    searchRef.current = {
      setQuery(query, options) {
        currentQueryRef.current = { query, options };
        const view = cmRef.current?.view;
        if (!view || !query) return;
        const sq = new SearchQuery({
          search: query,
          caseSensitive: options.matchCase,
          wholeWord: options.wholeWord,
          regexp: options.regex,
          replace: '',
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
      },
      findNext() {
        const view = cmRef.current?.view;
        if (view) findNext(view);
      },
      findPrev() {
        const view = cmRef.current?.view;
        if (view) findPrevious(view);
      },
      replace(replacement) {
        const view = cmRef.current?.view;
        if (!view || !currentQueryRef.current) return;
        const sq = new SearchQuery({
          search: currentQueryRef.current.query,
          caseSensitive: currentQueryRef.current.options.matchCase,
          wholeWord: currentQueryRef.current.options.wholeWord,
          regexp: currentQueryRef.current.options.regex,
          replace: replacement,
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
        replaceNext(view);
      },
      replaceAll(replacement) {
        const view = cmRef.current?.view;
        if (!view || !currentQueryRef.current) return;
        const sq = new SearchQuery({
          search: currentQueryRef.current.query,
          caseSensitive: currentQueryRef.current.options.matchCase,
          wholeWord: currentQueryRef.current.options.wholeWord,
          regexp: currentQueryRef.current.options.regex,
          replace: replacement,
        });
        if (!sq.valid) return;
        view.dispatch({ effects: sq.asEffect() });
        replaceAll(view);
      },
      getMatchInfo() {
        // CodeMirror doesn't expose match count directly; return -1 to indicate unknown
        return { current: -1, total: -1 };
      },
    };
    return () => {
      if (searchRef) searchRef.current = null;
    };
  }, [searchRef]);

  return (
    <div className="flex-1 overflow-auto h-full">
      <CodeMirror
        ref={cmRef}
        value={value}
        height="100%"
        theme={isDark ? oneDark : 'light'}
        extensions={[
          markdown({ codeLanguages: languages }),
          EditorView.contentAttributes.of({ spellcheck: 'true' }),
          search({ top: false }),
        ]}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: true,
          indentOnInput: true,
          searchKeymap: false,
        }}
        style={{ height: '100%', fontSize: '13px' }}
      />
    </div>
  );
}
```

Note: `searchKeymap: false` prevents CodeMirror's built-in Ctrl+F from triggering (our dialog handles it instead). The `search({ top: false })` extension loads CodeMirror's search state but hides its built-in panel.

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/editor/RawEditor.tsx
git commit -m "feat: expose searchRef from RawEditor for external find/replace control"
```

---

## Task 6: FindReplaceDialog component

**Files:**
- Create: `src/renderer/ui/find-replace/FindReplaceDialog.tsx`

- [ ] **Step 1: Create the dialog component**

```typescript
// src/renderer/ui/find-replace/FindReplaceDialog.tsx
import React, { useEffect, useRef, useCallback } from 'react';
import { X, ArrowUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import { useFindReplaceStore } from '../../store/find-replace-store';
import { useEditorStore } from '../../store/editor-store';
import type { Editor } from '@tiptap/core';
import type { RawSearchHandle } from '../../editor/RawEditor';

interface FindReplaceDialogProps {
  editor: Editor | null;
  searchRef: React.MutableRefObject<RawSearchHandle | null>;
}

export function FindReplaceDialog({ editor, searchRef }: FindReplaceDialogProps) {
  const store = useFindReplaceStore();
  const { isRawMode } = useEditorStore();

  const posRef = useRef({ x: window.innerWidth - 460, y: 60 });
  const dialogRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus find input when opened
  useEffect(() => {
    if (store.isOpen) {
      setTimeout(() => findInputRef.current?.focus(), 0);
    }
  }, [store.isOpen]);

  // Apply search when query/options change
  useEffect(() => {
    if (!store.isOpen || !store.query) {
      if (store.query === '') {
        if (!isRawMode) editor?.commands.clearSearch();
      }
      return;
    }
    triggerSearch(store.query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.query, store.options.matchCase, store.options.wholeWord, store.options.regex, store.isOpen]);

  const triggerSearch = useCallback(
    (query: string) => {
      if (isRawMode) {
        searchRef.current?.setQuery(query, store.options);
        store.setMatchInfo(-1, -1);
      } else if (editor) {
        editor.commands.setSearchQuery(query, store.options);
        // Read back match info after plugin updates
        setTimeout(() => {
          const info = (editor.commands as any).getMatchCount() as {
            count: number; index: number; scope: string; regexError: string | null;
          };
          store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
          store.setRegexError(info.regexError);
        }, 20);
      }
    },
    [isRawMode, editor, searchRef, store],
  );

  const handleFindNext = useCallback(() => {
    store.setStatusMessage(null);
    if (store.query) store.pushFindHistory(store.query);
    if (isRawMode) {
      searchRef.current?.findNext();
    } else {
      editor?.commands.findNext();
      setTimeout(() => {
        const info = (editor?.commands as any)?.getMatchCount?.() as any;
        if (info) store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
      }, 20);
    }
  }, [isRawMode, editor, searchRef, store]);

  const handleFindPrev = useCallback(() => {
    store.setStatusMessage(null);
    if (store.query) store.pushFindHistory(store.query);
    if (isRawMode) {
      searchRef.current?.findPrev();
    } else {
      editor?.commands.findPrev();
      setTimeout(() => {
        const info = (editor?.commands as any)?.getMatchCount?.() as any;
        if (info) store.setMatchInfo(info.count, info.index, info.scope !== 'text' ? (info.scope === 'mermaid' ? 'Mermaid' : 'Math') : null);
      }, 20);
    }
  }, [isRawMode, editor, searchRef, store]);

  const handleReplace = useCallback(() => {
    if (store.replacement) store.pushReplaceHistory(store.replacement);
    if (isRawMode) {
      searchRef.current?.replace(store.replacement);
    } else {
      editor?.commands.replaceMatch(store.replacement);
      setTimeout(() => {
        triggerSearch(store.query);
      }, 30);
    }
  }, [isRawMode, editor, searchRef, store, triggerSearch]);

  const handleReplaceAll = useCallback(() => {
    if (store.query) store.pushFindHistory(store.query);
    if (store.replacement) store.pushReplaceHistory(store.replacement);
    if (isRawMode) {
      searchRef.current?.replaceAll(store.replacement);
      store.setStatusMessage('Replaced occurrences');
    } else {
      const countBefore = store.matchCount;
      editor?.commands.replaceAll(store.replacement);
      store.setStatusMessage(`Replaced ${countBefore} occurrence${countBefore !== 1 ? 's' : ''}`);
      setTimeout(() => {
        triggerSearch(store.query);
      }, 30);
    }
  }, [isRawMode, editor, searchRef, store, triggerSearch]);

  const handleClose = useCallback(() => {
    store.close();
    if (!isRawMode) editor?.commands.clearSearch();
    store.clearMatchState();
  }, [store, isRawMode, editor]);

  // Keyboard shortcuts within dialog
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleFindNext();
      } else if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        handleFindPrev();
      } else if (e.key === 'F3' && e.shiftKey) {
        e.preventDefault();
        handleFindPrev();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleFindNext();
      }
    },
    [handleClose, handleFindNext, handleFindPrev],
  );

  // Dragging
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current || !dialogRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      posRef.current = { x: dragRef.current.origX + dx, y: dragRef.current.origY + dy };
      dialogRef.current.style.left = `${posRef.current.x}px`;
      dialogRef.current.style.top = `${posRef.current.y}px`;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  if (!store.isOpen) return null;

  const hasRegexError = !!store.regexError;
  const activeList = store.activeTab;

  const statusText = (() => {
    if (store.statusMessage) return store.statusMessage;
    if (!store.query) return null;
    if (store.regexError) return `Invalid regex: ${store.regexError}`;
    if (store.matchCount === 0) return 'No matches';
    if (store.matchCount === -1) return null; // CodeMirror raw mode — no count available
    const scope = store.scopeLabel ? ` · Searching in: ${store.scopeLabel}` : '';
    return `${store.currentMatchIndex + 1} of ${store.matchCount} matches${scope}`;
  })();

  const statusColor =
    store.regexError || store.matchCount === 0
      ? 'text-red-500'
      : store.statusMessage
        ? 'text-green-600 dark:text-green-400'
        : 'text-gray-500 dark:text-gray-400';

  return (
    <div
      ref={dialogRef}
      className="fixed z-50 w-[420px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl select-none"
      style={{ left: posRef.current.x, top: posRef.current.y }}
      onKeyDown={handleKeyDown}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 cursor-move rounded-t-lg bg-gray-50 dark:bg-gray-800"
        onMouseDown={onMouseDown}
      >
        <span className="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wide">
          Find &amp; Replace
        </span>
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded p-0.5"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-700">
        {(['find', 'replace'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => store.setActiveTab(tab)}
            className={`px-4 py-1.5 text-xs font-medium capitalize border-b-2 transition-colors ${
              store.activeTab === tab
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="p-3 space-y-2">
        {/* Find input */}
        <div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                ref={findInputRef}
                type="text"
                value={store.query}
                onChange={(e) => store.setQuery(e.target.value)}
                placeholder="Find…"
                list="find-history"
                className="w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7"
              />
              {/* History dropdown trigger — simple datalist approach */}
              <datalist id="find-history">
                {store.findHistory.map((h, i) => (
                  <option key={i} value={h} />
                ))}
              </datalist>
            </div>
            <button
              onClick={handleFindPrev}
              disabled={!store.query || hasRegexError}
              title="Find Previous (Shift+Enter)"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              <ChevronUp size={14} />
            </button>
            <button
              onClick={handleFindNext}
              disabled={!store.query || hasRegexError}
              title="Find Next (Enter)"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              <ChevronDown size={14} />
            </button>
          </div>
          {hasRegexError && (
            <p className="text-xs text-red-500 mt-1 ml-1">{store.regexError}</p>
          )}
        </div>

        {/* Replace input */}
        {activeList === 'replace' && (
          <div className="flex gap-2">
            <input
              type="text"
              value={store.replacement}
              onChange={(e) => store.setReplacement(e.target.value)}
              placeholder="Replace with…"
              className="flex-1 px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              list="replace-history"
            />
            <datalist id="replace-history">
              {store.replaceHistory.map((h, i) => (
                <option key={i} value={h} />
              ))}
            </datalist>
            <button
              onClick={() => {
                const tmp = store.query;
                store.setQuery(store.replacement);
                store.setReplacement(tmp);
              }}
              title="Swap find and replace"
              className="px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <ArrowUpDown size={14} />
            </button>
          </div>
        )}

        {/* Options */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {(
            [
              ['matchCase', 'Match case'],
              ['wholeWord', 'Whole word'],
              ['regex', 'Regex'],
              ['wrap', 'Wrap'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={store.options[key] as boolean}
                onChange={(e) => {
                  store.setOption(key, e.target.checked);
                }}
                className="rounded"
              />
              {label}
            </label>
          ))}
          {activeList === 'replace' && (
            <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={store.options.inSelection}
                disabled={store.scopeLabel !== null}
                onChange={(e) => {
                  if (!editor) return;
                  const { from, to, empty } = editor.state.selection;
                  if (e.target.checked && !empty) {
                    store.setOption('inSelection', true);
                    store.setOption('selectionFrom', from);
                    store.setOption('selectionTo', to);
                  } else {
                    store.setOption('inSelection', false);
                    store.setOption('selectionFrom', undefined);
                    store.setOption('selectionTo', undefined);
                  }
                }}
                className="rounded disabled:opacity-40"
              />
              In selection
            </label>
          )}
        </div>

        {/* Status */}
        {statusText && (
          <p className={`text-xs ${statusColor} min-h-[16px]`}>{statusText}</p>
        )}

        {/* Replace action buttons */}
        {activeList === 'replace' && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleReplace}
              disabled={!store.query || hasRegexError}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Replace
            </button>
            <button
              onClick={handleReplaceAll}
              disabled={!store.query || hasRegexError}
              className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Replace All
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/ui/find-replace/FindReplaceDialog.tsx
git commit -m "feat: add FindReplaceDialog floating component"
```

---

## Task 7: App.tsx integration

**Files:**
- Modify: `src/renderer/components/App.tsx`

- [ ] **Step 1: Add imports to App.tsx**

Add these imports near the top of `App.tsx` (with the other imports):

```typescript
import { FindReplaceDialog } from '../ui/find-replace/FindReplaceDialog';
import { useFindReplaceStore } from '../store/find-replace-store';
import type { RawSearchHandle } from '../editor/RawEditor';
```

- [ ] **Step 2: Add refs and store inside the App function body**

After the existing `const rawContentRef = useRef('')` line, add:

```typescript
const rawSearchRef = useRef<RawSearchHandle | null>(null);
const findReplaceStore = useFindReplaceStore();
```

- [ ] **Step 3: Handle find/replace menu actions**

Find the `handleMenuAction` callback (or the `onMenuAction` IPC listener in App.tsx). Add cases for `'find-open'` and `'replace-open'`. The menu action listener calls `sendAction('find-open')` etc. Locate the block that handles menu actions — it will be inside a `useEffect` that calls `window.electronAPI.onMenuAction(...)`. Add the two new cases:

```typescript
case 'find-open': {
  const sel = editor?.state.selection;
  const prefill = sel && !sel.empty
    ? editor?.state.doc.textBetween(sel.from, sel.to, ' ')
    : undefined;
  findReplaceStore.open('find', prefill);
  break;
}
case 'replace-open': {
  const sel = editor?.state.selection;
  const prefill = sel && !sel.empty
    ? editor?.state.doc.textBetween(sel.from, sel.to, ' ')
    : undefined;
  findReplaceStore.open('replace', prefill);
  break;
}
```

- [ ] **Step 4: Reset find state on new file load**

Find the `loadContent` call sites in App.tsx (in `handleFileChanged`, `doNew`, etc.). After each `loadContent(...)` call, add:

```typescript
editor?.commands.clearSearch();
findReplaceStore.clearMatchState();
// If dialog is open and query is set, re-trigger search after load
if (findReplaceStore.isOpen && findReplaceStore.query) {
  setTimeout(() => {
    editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
  }, 50);
}
```

- [ ] **Step 5: Reset find state on mode toggle**

Find the `handleToggleRawMode` function. Before calling `setRawMode(...)`, add:

```typescript
// Clear search state on the departing backend
if (!isRawMode) {
  // Switching WYSIWYG → Raw: clear TipTap decorations
  editor?.commands.clearSearch();
} else {
  // Switching Raw → WYSIWYG: clear CodeMirror state
  rawSearchRef.current?.setQuery('', findReplaceStore.options);
}
findReplaceStore.clearMatchState();
```

After the mode switch completes, if the dialog is open and a query exists, re-issue the search (add after the `loadContent` call for Raw→WYSIWYG, or after `setRawMode` for WYSIWYG→Raw):

```typescript
if (findReplaceStore.isOpen && findReplaceStore.query) {
  setTimeout(() => {
    if (!isRawMode) {
      // Now in raw mode
      rawSearchRef.current?.setQuery(findReplaceStore.query, findReplaceStore.options);
    } else {
      // Now in WYSIWYG mode
      editor?.commands.setSearchQuery(findReplaceStore.query, findReplaceStore.options);
    }
    findReplaceStore.clearMatchState();
  }, 50);
}
```

- [ ] **Step 6: Pass searchRef to RawEditor**

Find the `<RawEditor .../>` JSX in App.tsx and add the `searchRef` prop:

```tsx
<RawEditor
  value={rawContentRef.current}
  onChange={...}
  isDark={resolvedTheme === 'dark'}
  searchRef={rawSearchRef}
/>
```

- [ ] **Step 7: Render the dialog**

Find where the other dialogs are rendered at the bottom of the App JSX (e.g. near `<HelpDialog .../>`) and add:

```tsx
<FindReplaceDialog editor={editor} searchRef={rawSearchRef} />
```

- [ ] **Step 8: Run lint**

```bash
npm run lint
```

- [ ] **Step 9: End-to-end manual verification**

Run the app: `npm start`

Check these behaviours:
1. **Ctrl+F** opens dialog on Find tab; **Ctrl+H** opens on Replace tab
2. Type a word that exists in the document → status shows `"X of Y matches"`, matches highlighted in yellow
3. Enter / Find Next cycles through matches; current match highlighted in blue
4. **Match case**, **Whole word**, **Regex** checkboxes filter results correctly
5. **Regex** with invalid pattern shows red error message and disables Find Next
6. **Replace** replaces current match; **Replace All** replaces all and shows count message
7. With **Track Changes** on: Replace produces green insertion + strikethrough original
8. **Escape** closes dialog and removes all highlights
9. Switch to Raw mode with dialog open → search re-runs in CodeMirror
10. Open a new file with dialog open → match count resets

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/App.tsx
git commit -m "feat: integrate FindReplaceDialog into App with menu actions and lifecycle handling"
```

---

## Done

All tasks complete. The feature is fully integrated. For a code review before merging, use `superpowers:requesting-code-review`.
