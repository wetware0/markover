# Changelog

All notable changes to Markover are documented here.

---

## [1.0.10](https://github.com/wetware0/markover/compare/v1.0.9...v1.0.10) — 2026-05-23

### Security

- **Resolved five high-severity XML injection CVEs in transitive dependency `@xmldom/xmldom`** — `plist@3.1.0` pulled in `@xmldom/xmldom ^0.8.8`, which had five CVEs (CVSS 7.5). Pinned to `0.8.13` via npm `overrides` — the first release that clears all five. `npm audit fix` was avoided to prevent an unintended major upgrade of Vite.

### Fixed

- **Opening files containing both inline `code` in a bullet list and a code block left the editor blank** — the post-load history-clear ran synchronously before React node views finished mounting, crashing prosemirror-view's NodeViewDesc differ with `Cannot read properties of undefined (reading 'children')`. The history reset is now deferred to the next macrotask.

---

## [1.0.9](https://github.com/wetware0/markover/compare/v1.0.8...v1.0.9) — 2026-05-20

### Fixed

- **Bold text selected with adjacent whitespace no longer reopens as literal asterisks** — markdown serialization now keeps leading/trailing whitespace outside flanking-sensitive mark delimiters, so selections like `**Bold **` are saved as `**Bold** ` and inter-word leading-space selections save as `Hello **Bold**`.
- **Previously damaged bold markdown is recovered on load** — files containing `**Bold **`, `\*\*Bold \*\*`, or the equivalent leading-space form are parsed back into bold text and re-saved in valid markdown.

### Internal

- Expanded the headless markdown roundtrip suite to cover bold selections with leading/trailing whitespace and already-escaped malformed bold from previous saves.

---

## [1.0.8](https://github.com/wetware0/markover/compare/v1.0.7...v1.0.8) — 2026-05-19

### Fixed

- **Task list checkbox state was lost on load** — `- [ ] todo` round-tripped as `- todo`. The markdown-it HTML didn't match TipTap's `data-type=taskItem`/`data-checked` parse rules; now translated in the parser.
- **Footnote definitions were lost on load** — `[^1]: text` round-tripped as a horizontal rule plus an ordered list because markdown-it-footnote wraps the items in `<hr><section><ol>` and TipTap parsed those wrappers first. The wrappers are now stripped before TipTap sees the HTML, and `li.footnote-item` has higher parse priority than the generic `<li>` rule.
- **Nested lists were promoted to "loose" on every save** — `- outer\n  - inner` inflated to `- outer\n\n  - inner` because the looseness check counted nested lists as "meaningful" block children. Only multiple non-empty paragraphs now trigger looseness.
- **Blockquotes accumulated `  ` (hard-break trailing spaces) on every save** — the parser converts soft breaks to hard breaks inside blockquotes; the serializer was preserving the trailing spaces even though the parser would re-add them on load. Stripped on serialize.
- **Block-level images gained two leading blank lines per save** — empty-paragraph artifacts left when ProseMirror extracts `<img>` out of its `<p>` wrapper. The serializer now skips empty top-level paragraphs.
- **Toolbar "Track Changes" button left focus on itself** — subsequent keyboard shortcuts (e.g. Ctrl+A then Delete to ghost-delete) went to the button instead of the editor. Focus now returns to the editor after toggling.

### Internal

- Restored the Playwright e2e suite (was unable to launch the binary because of a security fuse and a teardown dialog race). Test builds opt into `EnableNodeCliInspectArguments` via `MARKOVER_TEST_BUILD=1`; tests run via `--markover-e2e-test` (set on `additionalArguments`) which the renderer reads to skip the unsaved-changes guard during teardown. Full suite is 27/27 in ~23 seconds.
- New headless roundtrip suite at `scripts/roundtrip-test.ts` — 56 cases covering every markdown feature plus the Markover codec, runs without Electron under JSDOM in ~3 seconds. Recommended first-line check when changing anything in `src/renderer/editor/markdown/` or `src/shared/markover-codec/`.

---

## [1.0.7](https://github.com/wetware0/markover/compare/v1.0.6...v1.0.7) — 2026-03-28

### Added

- **Image drop dialog** — Dropping an image onto the editor now shows an "Insert Image" dialog before inserting, giving the user control over the path format:
  - **Use relative path** — stores the path relative to the document location (pre-checked when the document is saved; disabled with a hint otherwise)
  - **Embed as Base64** — encodes the image as a `data:image/…;base64,…` URL embedded directly in the markdown file
  - **Absolute path** — default when no document is saved or the image is on a different drive
  - Alt text is pre-populated from the filename (minus extension) and is editable before inserting
  - Live path preview updates reactively as options are toggled

### Fixed

- Base64-embedded images now survive the save → reload round-trip (relaxed TipTap `parseHTML` rule to allow `img[src]` without the `data:` exclusion)
- `markdown-it` `validateLink` broadened to permit all `data:image/` URIs so base64 images are not stripped on parse

---

## [1.0.6](https://github.com/wetware0/markover/compare/v1.0.5...v1.0.6) — 2026-03-28

### Fixed

- Image paths containing spaces are now wrapped in angle brackets (`<…>`) in serialized markdown so they round-trip correctly

---

## [1.0.5](https://github.com/pjwilliams2/markover/compare/v1.0.4...v1.0.5) — 2026-03-21

### Added

- **File attachment drop** — Dragging any non-image file onto the editor inserts a clickable file-type icon linked to the file (`[![name](icon)](path)`); icon colour reflects file type (PDF, Word, Excel, PowerPoint, archive, code, video, audio, etc.)
- **Relative image paths** — Images and file links dragged onto the editor are stored as paths relative to the document location; absolute paths are used as fallback when the file is on a different drive or the document has not been saved yet

### Fixed

- Drag-and-drop used deprecated `file.path` (empty in Electron 32+); switched to `webUtils.getPathForFile()` so dropped images are correctly stored as local paths instead of base64 data URLs
- SVG data URIs are now recognised as valid image sources by the markdown-it parser (previously blocked, causing dropped file icons to appear as raw markdown text after save/reload)

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

