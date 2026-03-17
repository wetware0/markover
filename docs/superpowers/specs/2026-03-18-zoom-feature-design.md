# Zoom Feature Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Add zoom in/out to the Markover editor so users can scale editor content to fill available screen real estate when the window is expanded. The toolbar, status bar, and dialogs remain unaffected — only the editor content scales.

## Scope

- WYSIWYG editor content (TipTap / ProseMirror)
- Raw editor content (CodeMirror)
- Zoom range: 50%–200%, step 10%, default 100%
- No persistence in initial implementation (architected for easy addition later)

## State: `zoom-store.ts`

New file: `src/renderer/store/zoom-store.ts`

Zustand store with:
- `zoomLevel: number` — stores the zoom as a plain integer percentage (e.g. `100` means 100%). Applied in JSX as `` `${zoomLevel}%` ``
- `zoomIn()` — increment by 10, max 200
- `zoomOut()` — decrement by 10, min 50
- `resetZoom()` — set to 100

Shaped for future persistence via Zustand `persist` middleware targeting `localStorage` (single wrapper addition, no other changes).

## Editor Content Scaling

### WYSIWYG Mode

**`src/renderer/styles.css`**
- Change `.ProseMirror { font-size: 16px }` to `font-size: 1em`. At `zoomLevel === 100` the wrapper resolves to 100% of Electron's document default (16px) — identical to the current value.
- The existing `@media print` rule that sets `.ProseMirror { font-size: 12pt }` is an explicit rule on the element itself and takes precedence over the inherited zoom from the wrapper — so print output is always 12pt regardless of zoom level. No additional print reset is needed on the wrapper.

**`src/renderer/components/App.tsx`** — WYSIWYG branch (`!isRawMode`)
Apply `style={{ fontSize: `${zoomLevel}%` }}` to the `max-w-4xl mx-auto` inner wrapper div. This is already inside the `!isRawMode` conditional branch, so it only affects WYSIWYG mode.

### Raw Mode (CodeMirror)

CodeMirror 6 does not inherit `font-size` from its container by default. Add to `styles.css`:

```css
.cm-editor {
  font-size: inherit;
}
```

In `App.tsx`, wrap `<RawEditor />` with a div that **preserves the existing flex layout**:

```tsx
<div className="flex flex-1 overflow-hidden" style={{ fontSize: `${zoomLevel}%` }}>
  <RawEditor ... />
</div>
```

`flex flex-1 overflow-hidden` is required: `flex` establishes a flex formatting context so that `<RawEditor>`'s own `flex-1` root div sizes correctly; without it the raw editor collapses to zero height. This keeps zoom logic centralised in `App.tsx` without modifying `RawEditor.tsx`.

## User Interactions

### Ctrl+Wheel
Attach a wheel event listener to `window` via `useEffect` in `App.tsx`, registered as `{ passive: false }`:
- Fires only when `event.ctrlKey === true`
- `deltaY < 0` → `zoomIn()`
- `deltaY > 0` → `zoomOut()`
- `event.preventDefault()` to suppress browser/OS native zoom

### Keyboard Shortcuts
Attach a `keydown` listener to `window` via `useEffect` in `App.tsx`, registered as `{ capture: true }` to ensure it fires before TipTap/CodeMirror key handlers:
- `Ctrl++` — `(event.key === '+' || event.key === '=') && event.ctrlKey` → `zoomIn()`; call `preventDefault()` + `stopPropagation()`
- `Ctrl+−` — `event.key === '-' && event.ctrlKey` → `zoomOut()`; call `preventDefault()` + `stopPropagation()`
- `Ctrl+0` — `event.key === '0' && event.ctrlKey` → `resetZoom()`; call `preventDefault()` + `stopPropagation()`

`stopPropagation()` (in capture phase) prevents these combos from reaching CodeMirror's fold/unfold handlers. The wheel listener does not need capture phase as CodeMirror does not intercept wheel events.

Zoom is intentionally **not** wired into the Electron main menu — it is a view preference, not a document operation, and is fully handled in the renderer.

### Toolbar Buttons
Three controls added **immediately after the `flex-1` spacer** (making them the leftmost of the right-side group), visible in both WYSIWYG and raw mode:
- `−` button (`ToolbarButton`) → `zoomOut()`, disabled when `zoomLevel === 50`
- A `<span>` (not a button) showing current zoom (e.g. `100%`) — `min-w-[3.5rem] text-center text-sm text-gray-700 dark:text-gray-300` — read-only display only (click-to-reset lives in the status bar)
- `+` button (`ToolbarButton`) → `zoomIn()`, disabled when `zoomLevel === 200`

Followed by a standard toolbar divider before the Raw Mode Toggle. In raw mode the Sidebar Toggle is hidden but the Raw Mode Toggle remains, so the divider has a valid right neighbour in all modes.

### Status Bar
In `src/renderer/ui/statusbar/StatusBar.tsx`:
- Add zoom percentage display (e.g. `100%`) on the right side
- Shown in **both WYSIWYG and raw mode** (raw mode also scales)
- Clicking it calls `resetZoom()`
- `cursor-pointer`, tooltip `"Reset zoom"`

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/store/zoom-store.ts` | New file — Zustand zoom store |
| `src/renderer/styles.css` | `.ProseMirror font-size` → `1em`; add `.cm-editor { font-size: inherit }` |
| `src/renderer/components/App.tsx` | Zoom style wrappers (both modes); window wheel + capture keydown listeners |
| `src/renderer/ui/toolbar/Toolbar.tsx` | Add zoom −/span/+ controls immediately after flex-1 spacer |
| `src/renderer/ui/statusbar/StatusBar.tsx` | Add zoom % indicator with reset-on-click (both modes) |

## Future Persistence

To persist zoom across sessions, wrap the store export with Zustand's `persist` middleware targeting `localStorage`. No other changes required.
