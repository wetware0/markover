# Changelog

All notable changes to Markover are documented here.

---

## [1.0.4](https://github.com/pjwilliams2/markover/compare/v1.0.3...v1.0.4) — 2026-03-18

### Added

- **Zoom controls** — Zoom in/out toolbar buttons and `Ctrl Wheel` / keyboard shortcuts (`Ctrl +` / `Ctrl -` / `Ctrl 0`) to scale document view from 50–200%
- **Zoom indicator** — Percentage display in the status bar; click to reset to 100%

### Fixed

- Document width scales correctly with zoom level while remaining centred
- Removed `max-w-4xl` constraint so the document fills the available window width
- Print/PDF font size is locked via `!important` so zoom level does not bleed into exported output
- `ProseMirror` and `cm-editor` now inherit `font-size` from their parent so zoom applies uniformly across both editing modes

---

## [1.0.3](https://github.com/pjwilliams2/markover/compare/v1.0.2...v1.0.3) — 2026-03-17

### Added

- **Find & Replace** — Floating dialog (`Ctrl+F` / `Ctrl+H`) with match highlighting, navigation, regex support, and case/whole-word options
- Find & Replace works in both WYSIWYG (TipTap ProseMirror plugin with decoration highlights) and raw CodeMirror mode
- Replace preserves inline marks (bold, italic, etc.) on replaced text
- Search history is persisted to `localStorage`

### Fixed

- Unsaved-changes guard was not blocking window close; now correctly intercepts the Electron `close` event
- Corrected CodeMirror 6 search API usage and added missing type declarations
- `inSelection` filter reactivity issue resolved
- Find store hardened: `regexError` clears on query change, safe `localStorage` parse, extracted key constants
- `FIND_OPEN` / `REPLACE_OPEN` constant values aligned with menu action payload strings
- `triggerSearch` ordering fixed; replaced stale-closure `getMatchCount` command with `getMatchInfo` function

---

## [1.0.2](https://github.com/pjwilliams2/markover/compare/v1.0.1...v1.0.2) — 2026-03-17

### Added

- **Table column alignment** — Alignment buttons (left / center / right) in the table context bar; alignment round-trips correctly through the Markover codec
- **Link text editing** — Link dialog now shows and edits the visible link text alongside the URL

### Fixed

- PDF / print export now renders the full document instead of clipping to the visible viewport (removed `h-screen` / `overflow` constraints during print via Tailwind `print:` variants)
- Track-changes data loss when deleting table rows/cells and code blocks
- Track-changes `Ctrl+Z` leak that caused blank-page regressions
- Empty-paragraph trailing spaces left by track changes serializer
- `Ctrl+Z` blank-page regression: skip re-insertion when undo restores tracked-delete text
- Undo history is cleared after file load so `Ctrl+Z` cannot blank the document
- `onFileChanged` guarded with dirty check to prevent silent data loss

---

## [1.0.1](https://github.com/pjwilliams2/markover/compare/v1.0.0...v1.0.1) — 2026-03-16 (pre-release stabilisation)

### Added

- **Image support improvements** — Local images resolved via `markover-asset:` protocol; edit dialog shows preview, URL, alt text, and width; drag-and-drop and paste support
- **Author identity** — Default author name set from OS username on first launch; configurable via avatar button
- **Dynamic heading levels** — Toolbar always shows H1–H3; reveals H(N+1) when the next level is in use
- **Linked file navigation** — Clicking a `.md` link opens the file in a new Markover instance instead of the system browser
- **Recent files** — Deduplicated (case-insensitive on Windows), most-recently-used ordering
- **About dialog** — Accessible via Help menu

### Fixed

- Markdown round-trip fidelity: mark diffing, nested list indent, trailing spaces
- Recent files list deduplicated with case-insensitive comparison on Windows
- Link clicks and italic serialization corrected
- Image round-trip: link wrapper preserved, blank line after block image
- Footnote double-bracket bug on save/reload
- Serializer round-trip bugs: code fence language collision, link title quoting
- CSS build warning from fragile `.gap-0.5` print selector
- Sidebar panels cut off by the status bar
- `BubbleMenu` crash (removed in TipTap v3) replaced with `TableContextBar`
- File > Open dialog handled directly in main process to fix open failures

---

## [1.0.0](https://github.com/pjwilliams2/markover/releases/tag/v1.0.0) — Initial Release

### Core Editor

- WYSIWYG markdown editing via TipTap / ProseMirror
- Full CommonMark support with live rendering
- Raw editing mode via CodeMirror 6 with syntax highlighting (`Ctrl+Shift+R`)
- Rich formatting: bold, italic, underline, strikethrough, inline code, H1–H6, blockquotes, lists, tables, horizontal rules
- Code blocks with language selector and syntax highlighting (Lowlight/Highlight.js)
- KaTeX math (inline `$…$` and block `$$…$$`) with click-to-edit
- Mermaid diagrams with click-to-edit
- Footnotes, front matter (YAML), and image handling

### Collaboration

- **Comments** — Select text and create threaded comment annotations; shown in the sidebar and highlighted in the document; replies, resolve, and delete
- **Track Changes** — Mark insertions (green) and deletions (red strikethrough); accept or reject individually or all at once

### Markover Codec

- Custom file format round-trips all metadata (comments, highlights, track changes) through HTML comments and inline spans embedded in standard `.md` files
- Metadata is invisible or benign in other Markdown renderers
- **Publish** — Export a clean `.md` file with all metadata stripped and tracked changes accepted (`Ctrl+Shift+P`)

### File Handling

- Open / Save / Save As for `.md` files
- CLI file argument support
- Unsaved-changes guard for close, New, and Open
- Windows installer and auto-update scaffolding

### Other

- Spell check via Electron Hunspell with context-menu suggestions; per-document ignore list persisted in the file
- Light / Dark / System theme support
- Print and PDF export via Electron `printToPDF`
- In-app user guide (`F1` / Help menu)
- Playwright E2E tests for comments, track changes, blocks, and round-trip fidelity
- cspell ignore support — persisted in markdown and respected on publish
- Full keyboard shortcut set

---

