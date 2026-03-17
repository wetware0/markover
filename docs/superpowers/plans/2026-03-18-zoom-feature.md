# Zoom Feature Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editor-content zoom (50–200%, step 10%) controlled via Ctrl+Wheel, Ctrl++/−/0 keyboard shortcuts, toolbar ±buttons, and a status bar reset indicator.

**Architecture:** A new Zustand store holds `zoomLevel` (integer percent, default 100). `App.tsx` applies it as an inline `fontSize` CSS property on the editor content wrapper (WYSIWYG) and a wrapper div around `<RawEditor>` (raw mode). Window-level event listeners handle keyboard and wheel input. Toolbar and status bar read from the same store.

**Tech Stack:** React 19, Zustand, Tailwind CSS 4, TypeScript strict, Lucide icons, Electron (renderer process only — no IPC needed).

> **Note:** No test framework is configured in this project. Verification steps are manual, run via `npm start`.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/renderer/store/zoom-store.ts` | **Create** | Zustand store: zoomLevel, zoomIn, zoomOut, resetZoom |
| `src/renderer/styles.css` | **Modify** | `.ProseMirror font-size: 1em`; `.cm-editor { font-size: inherit }` |
| `src/renderer/components/App.tsx` | **Modify** | Zoom wrappers on editor containers; window wheel + keydown listeners |
| `src/renderer/ui/toolbar/Toolbar.tsx` | **Modify** | Zoom −/display/+ controls after flex-1 spacer |
| `src/renderer/ui/statusbar/StatusBar.tsx` | **Modify** | Zoom % display with click-to-reset |

---

## Task 1: Zoom Store

**Files:**
- Create: `src/renderer/store/zoom-store.ts`

- [ ] **Step 1: Create the zoom store**

Create `src/renderer/store/zoom-store.ts` with this exact content:

```typescript
import { create } from 'zustand';

interface ZoomState {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

export const useZoomStore = create<ZoomState>((set) => ({
  zoomLevel: 100,
  zoomIn: () => set((s) => ({ zoomLevel: Math.min(200, s.zoomLevel + 10) })),
  zoomOut: () => set((s) => ({ zoomLevel: Math.max(50, s.zoomLevel - 10) })),
  resetZoom: () => set({ zoomLevel: 100 }),
}));
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run lint`
Expected: no errors in `zoom-store.ts`

- [ ] **Step 3: Commit**

```bash
git add src/renderer/store/zoom-store.ts
git commit -m "feat: add zoom store (zoomIn/zoomOut/resetZoom, 50-200%)"
```

---

## Task 2: CSS — Base Font Inheritance + CodeMirror

**Files:**
- Modify: `src/renderer/styles.css:6-13` (ProseMirror block) and add new rule

- [ ] **Step 1: Change ProseMirror font-size**

In `src/renderer/styles.css`, find:
```css
.ProseMirror {
  outline: none;
  min-height: 100%;
  padding: 2rem 3rem;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
```

Change `font-size: 16px;` to `font-size: 1em;`:
```css
.ProseMirror {
  outline: none;
  min-height: 100%;
  padding: 2rem 3rem;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  font-size: 1em;
  line-height: 1.7;
}
```

This makes ProseMirror inherit font-size from its parent wrapper, which will carry the zoom percentage. At zoom=100% the parent resolves to 100% of the document default (16px in Electron) — identical to the current baseline.

- [ ] **Step 2: Add CodeMirror font-size inheritance rule**

After the closing `}` of the `.ProseMirror` block and before the `.ProseMirror > * + *` rule, insert:

```css
.cm-editor {
  font-size: inherit;
}
```

Without this, CodeMirror 6 ignores the container font-size and the raw mode zoom wrapper has no effect.

- [ ] **Step 3: Start app and verify WYSIWYG text still looks the same size**

Run: `npm start`
Expected: document text appears identical to before (still ~16px). The change is neutral until zoom wrappers are added in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles.css
git commit -m "fix: make ProseMirror and cm-editor font-size inherit from parent for zoom support"
```

---

## Task 3: App.tsx — Zoom Wrappers + Event Listeners

**Files:**
- Modify: `src/renderer/components/App.tsx`

### Step 3a — Import and zoom wrappers

- [ ] **Step 1: Add useZoomStore import**

Near the top of `App.tsx` where other store imports are, add:
```typescript
import { useZoomStore } from '../store/zoom-store';
```

- [ ] **Step 2: Destructure zoom store in the component**

Inside the `App` function, near where other stores are destructured (e.g. near `useEditorStore`), add:
```typescript
const { zoomLevel, zoomIn, zoomOut, resetZoom } = useZoomStore();
```

- [ ] **Step 3: Apply zoom wrappers to both WYSIWYG and RawEditor**

These are the two branches of a single ternary in `App.tsx` around line 619. Replace the entire ternary in one edit to avoid breaking the structure.

Find:
```tsx
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
```

Replace with:
```tsx
        {isRawMode ? (
          <div className="flex flex-1 overflow-hidden" style={{ fontSize: `${zoomLevel}%` }}>
            <RawEditor
              value={rawContentRef.current}
              onChange={(v) => { rawContentRef.current = v; setDirty(true); }}
              isDark={resolvedTheme === 'dark'}
              searchRef={rawSearchRef}
            />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto print:overflow-visible bg-white dark:bg-gray-900" onClick={handleEditorClick}>
          <div className="max-w-4xl mx-auto" style={{ fontSize: `${zoomLevel}%` }}>
            <EditorContent editor={editor} className="min-h-full" />
          </div>
        </div>
        )}
```

> **RawEditor wrapper note:** The outer parent `<div className="flex flex-1 overflow-hidden print:block print:overflow-visible">` already wraps the whole ternary. The new inner `<div className="flex flex-1 overflow-hidden">` is needed specifically because `<RawEditor>`'s own root div uses `flex-1`, which requires a flex formatting context on its *direct* parent — the outer wrapper is now the ternary parent, not `<RawEditor>`'s direct parent. Without `flex` on the new wrapper, CodeMirror collapses to zero height.

- [ ] **Step 5: Start app and verify both modes still render correctly**

Run: `npm start`

Check:
- WYSIWYG mode: text renders at normal size, no layout change
- Switch to raw mode (toolbar FileCode button): CodeMirror editor fills the space, no collapse

### Step 3b — Event listeners

- [ ] **Step 6: Add Ctrl+Wheel listener**

Inside the `App` function, add a `useEffect` for the wheel event. Place it near other `useEffect` hooks in the component:

```typescript
// Ctrl+Wheel zoom
useEffect(() => {
  const handleWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };
  window.addEventListener('wheel', handleWheel, { passive: false });
  return () => window.removeEventListener('wheel', handleWheel);
}, [zoomIn, zoomOut]);
```

- [ ] **Step 7: Add Ctrl++/−/0 keyboard listener**

Add a second `useEffect` immediately after the wheel one:

```typescript
// Ctrl++/−/0 zoom keyboard shortcuts
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!e.ctrlKey) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      e.stopPropagation();
      zoomIn();
    } else if (e.key === '-') {
      e.preventDefault();
      e.stopPropagation();
      zoomOut();
    } else if (e.key === '0') {
      e.preventDefault();
      e.stopPropagation();
      resetZoom();
    }
  };
  window.addEventListener('keydown', handleKeyDown, { capture: true });
  return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
}, [zoomIn, zoomOut, resetZoom]);
```

`{ capture: true }` ensures this fires before TipTap and CodeMirror's own key handlers, so `Ctrl+−` doesn't trigger CodeMirror's line fold.

- [ ] **Step 8: Verify all three interactions work**

Run: `npm start`

Check:
- Ctrl+Wheel up → text grows
- Ctrl+Wheel down → text shrinks
- Ctrl++ → text grows
- Ctrl+− → text shrinks
- Ctrl+0 → text returns to 100%
- Zoom works in both WYSIWYG and raw mode

- [ ] **Step 9: Commit**

```bash
git add src/renderer/components/App.tsx
git commit -m "feat: apply zoom wrappers and add Ctrl+Wheel/keyboard zoom interactions"
```

---

## Task 4: Toolbar — Zoom Controls

**Files:**
- Modify: `src/renderer/ui/toolbar/Toolbar.tsx`

- [ ] **Step 1: Add useZoomStore import to Toolbar**

Add to the imports at the top of `Toolbar.tsx`:
```typescript
import { useZoomStore } from '../../store/zoom-store';
```

Also add the `ZoomIn` and `ZoomOut` Lucide icons to the existing lucide-react import block:
```typescript
import {
  // ... existing icons ...
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
```

- [ ] **Step 2: Destructure zoom store inside Toolbar**

Inside the `Toolbar` function body, near where `useThemeStore` and `useUserStore` are called:
```typescript
const { zoomLevel, zoomIn, zoomOut } = useZoomStore();
```

- [ ] **Step 3: Insert zoom controls between the spacer and Raw Mode Toggle**

Find only the spacer div (around line 261):
```tsx
      <div className="flex-1" />

      {/* Raw mode toggle */}
```

Replace with (inserting the zoom group between them — do **not** change anything after `{/* Raw mode toggle */}`):
```tsx
      <div className="flex-1" />

      {/* Zoom controls */}
      <ToolbarButton
        onClick={zoomOut}
        disabled={zoomLevel <= 50}
        title="Zoom out (Ctrl+−)"
      >
        <ZoomOut size={iconSize} />
      </ToolbarButton>
      <span className="min-w-[3.5rem] text-center text-sm text-gray-700 dark:text-gray-300 select-none">
        {zoomLevel}%
      </span>
      <ToolbarButton
        onClick={zoomIn}
        disabled={zoomLevel >= 200}
        title="Zoom in (Ctrl++)"
      >
        <ZoomIn size={iconSize} />
      </ToolbarButton>

      <ToolbarDivider />

      {/* Raw mode toggle */}
```

Everything after `{/* Raw mode toggle */}` (Raw Mode Toggle button, User Identity, Theme Toggle, Sidebar Toggle, dialogs) remains **untouched**.

- [ ] **Step 4: Verify toolbar zoom controls**

Run: `npm start`

Check:
- Zoom − and + buttons appear to the right of the main toolbar content, left of the raw mode toggle
- Clicking + grows the text, clicking − shrinks it
- − button is disabled (greyed out) at 50%, + button is disabled at 200%
- Span shows current zoom percentage, updates in real time
- Controls visible in both WYSIWYG and raw mode

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/toolbar/Toolbar.tsx
git commit -m "feat: add zoom in/out toolbar buttons with live percentage display"
```

---

## Task 5: Status Bar — Zoom Indicator

**Files:**
- Modify: `src/renderer/ui/statusbar/StatusBar.tsx`

- [ ] **Step 1: Add useZoomStore import to StatusBar**

Add to the imports at the top of `StatusBar.tsx`:
```typescript
import { useZoomStore } from '../../store/zoom-store';
```

- [ ] **Step 2: Destructure zoom store inside StatusBar**

Inside the `StatusBar` function body:
```typescript
const { zoomLevel, resetZoom } = useZoomStore();
```

- [ ] **Step 3: Add zoom indicator to the right-side stats group**

Find the right-side `<div>` (the one containing word count, char count, cursor position):
```tsx
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1">
          <SpellCheck size={12} /> Spell Check
        </span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
      </div>
```

Add the zoom indicator as the first item inside that div:
```tsx
      <div className="flex items-center gap-4">
        <span
          onClick={resetZoom}
          title="Reset zoom (Ctrl+0)"
          className="cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
        >
          {zoomLevel}%
        </span>
        <span className="flex items-center gap-1">
          <SpellCheck size={12} /> Spell Check
        </span>
        <span>{wordCount} words</span>
        <span>{charCount} characters</span>
        <span>
          Ln {cursorLine}, Col {cursorCol}
        </span>
      </div>
```

- [ ] **Step 4: Verify status bar zoom indicator**

Run: `npm start`

Check:
- `100%` appears at the left of the right-side status bar group
- Hovering shows a pointer cursor and the text brightens
- Clicking resets zoom to 100% (toolbar span and text size both update)
- Works in both WYSIWYG and raw mode

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/statusbar/StatusBar.tsx
git commit -m "feat: add zoom percentage indicator to status bar with click-to-reset"
```

---

## Final Verification

- [ ] Open a document with headings, body text, code blocks, and a table
- [ ] Zoom to 150% via Ctrl+Wheel — verify all elements scale proportionally
- [ ] Zoom to 80% via toolbar − button — verify text shrinks
- [ ] Reset via status bar click — verify returns to 100%
- [ ] Switch to raw mode — verify CodeMirror text also scales with zoom
- [ ] Zoom to 50% — verify − button is disabled
- [ ] Zoom to 200% — verify + button is disabled
- [ ] Print preview (`Ctrl+P`) — verify printed text is normal size (not zoomed)
- [ ] Open a dialog (e.g. Insert Link) — verify dialog is unaffected by zoom
