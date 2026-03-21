<!-- cspell:ignore … word1 word2 -->

# Markover

A desktop Markdown editor with Word-like collaboration features — WYSIWYG editing, comments, track changes, and clean round-trip serialization.

Built with Electron, React, and TipTap (ProseMirror).

---

## Features

### Editing

- **WYSIWYG Markdown** — Full CommonMark editing with live rendering
- **Raw mode** — Toggle to syntax-highlighted source editing (CodeMirror) with `Ctrl+Shift+R`
- **Rich formatting** — Bold, italic, underline, strikethrough, inline code, headings H1–H6, blockquotes, horizontal rules
- **Lists** — Bullet, ordered, and task (checkbox) lists with indent/outdent
- **Tables** — Insert and edit tables; resize columns by dragging
- **Code blocks** — Syntax-highlighted fenced code blocks (Shiki/Lowlight) with language selector
- **Math** — Inline `$…$` and block `$$…$$` KaTeX rendering; double-click to edit
- **Diagrams** — Mermaid fenced code blocks rendered as diagrams; double-click to edit
- **Footnotes** — Standard `[^1]` footnote syntax
- **YAML front matter** — Displayed as a styled card at the top of the document
- **Images** — Insert by URL, drag-and-drop, or paste; stored as relative paths from the document; double-click to edit URL, alt text, and width
- **File attachments** — Drag any non-image file onto the editor to insert a clickable file-type icon linked to the file; icon colour reflects file type (PDF, Word, Excel, etc.)

### Collaboration

- **Comments** — Select text and add a comment thread; threads are shown in the sidebar and highlighted in the document; replies, resolve, and delete supported
- **Track Changes** — Enable tracking to mark insertions (green) and deletions (red strikethrough); accept or reject changes individually or all at once
- **Author identity** — Set your display name and colour via the avatar button in the toolbar

### File Handling

- **Open / Save / Save As** — Standard file operations for `.md` files
- **Recent files** — Deduplicated, most-recently-used ordering
- **Publish** — Export a clean `.md` file with all metadata stripped and all tracked changes accepted (`Ctrl+Shift+P`)
- **Unsaved changes guard** — Prompted to save (or discard) before closing, opening another file, or creating a new document
- **Linked files** — Clicking a `.md` link opens it in a new Markover instance; other links open in the system default app

### Other

- **Spell check** — Electron Hunspell integration with context-menu suggestions and "Add to dictionary"; per-document ignore list persisted as \`\` in the file
- **Light / Dark / System theme** — Toggleable from the toolbar
- **Print and PDF export** — Via Electron's `printToPDF`
- **Keyboard shortcuts** — Full shortcut set; `F1` opens the in-app user guide

---

## File Format

Markover saves standard `.md` files that open in any Markdown editor. Collaboration metadata is stored unobtrusively:

| Data | Storage |
| --- | --- |
| Comment threads | `<!-- markover:comment … -->` blocks appended at end of file |
| Comment highlights | `<span data-markov="hl" …>` inline HTML |
| Track-change insertions | `<span data-markov="ins" …>` inline HTML |
| Track-change deletions | `<span data-markov="del" …>` inline HTML |
| Spell-check ignores | `<!-- cspell:ignore XXXX -->` at top of file |

All metadata is invisible or benign in other Markdown renderers. Use **Publish** to produce a completely clean file.

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- npm 9 or later

### Install

```bash
git clone https://github.com/wetware0/markover.git
cd markover
npm install
```

### Run in development

```bash
npm start
```

### Build a distributable

```bash
npm run make
```

Output is placed in `out/make/`.

---

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+N` | New document |
| `Ctrl+O` | Open file |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+Shift+P` | Publish (export clean markdown) |
| `Ctrl+P` | Print |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+F` | Find |
| `Ctrl+H` | Find and replace |
| `Ctrl++` / `Ctrl+-` | Zoom in / Zoom out |
| `Ctrl+0` | Reset zoom |
| `Ctrl+B` | Bold |
| `Ctrl+I` | Italic |
| `Ctrl+U` | Underline |
| `Ctrl+Shift+X` | Strikethrough |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+E` | Code block |
| `Ctrl+Shift+B` | Blockquote |
| `Ctrl+Shift+R` | Toggle raw / WYSIWYG mode |
| `Ctrl+Shift+M` | Add comment (requires selection) |
| `Ctrl+Shift+T` | Toggle track changes |
| `F1` | User guide |

---

## Known Limitations

- **Track changes and structural edits** — Deleting across paragraph boundaries or through formatted node boundaries may not be tracked cleanly; the plugin skips structural changes to avoid corruption.
- **Blockquote line breaks** — Two consecutive `> `lines without a blank line are rendered with a hard line break between them (rather than merged into one paragraph). This is intentional but deviates from strict CommonMark behaviour.
- **Spell check in raw mode** — The CodeMirror raw editor uses the browser's built-in spell checker (red underlines) rather than Electron's Hunspell integration; context-menu suggestions are not available in raw mode.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| Shell | Electron 34 + Electron Forge |
| UI | React 19, Tailwind CSS 4 |
| Editor | TipTap 3 (ProseMirror) |
| Raw editor | CodeMirror 6 |
| Markdown parser | markdown-it |
| Math | KaTeX |
| Diagrams | Mermaid |
| Syntax highlighting | Shiki / Lowlight |
| State | Zustand |
| Icons | Lucide React |
| E2E tests | Playwright |

---

## License

MIT © Peter Williams

