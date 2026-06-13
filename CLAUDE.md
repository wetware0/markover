# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Markover is a desktop markdown editor built with Electron, React, and TipTap (ProseMirror-based). It supports comments, track changes, spell checking, KaTeX math, Mermaid diagrams, and PDF export.

## Commands

```bash
npm start              # Run in dev mode (electron-forge start)
npm run package        # Package the app
npm run make           # Create distributable
npm run lint           # ESLint (eslint --ext .ts,.tsx .)
npm test               # Playwright e2e suite (auto-builds a test-mode package)
npx tsx scripts/roundtrip-test.ts   # Headless markdown roundtrip suite (no Electron)
```

> **Note**: `npm install` runs cleanly without flags. (The former `--legacy-peer-deps`
> requirement came from an unused `@vitejs/plugin-react@6` devDependency, which pulled a
> `vite@^8` peer against the pinned `vite@^5.4.21`; it and the unused `@tailwindcss/vite`
> were removed — JSX is handled by `esbuild: { jsx: 'automatic' }` and Tailwind via
> `postcss.config.js`.)

### Testing

Two layers:

1. **Headless roundtrip suite** (`scripts/roundtrip-test.ts`): exercises the
   real parser+serializer+codec under JSDOM. Fast (≈3s), covers every
   markdown feature. Run this first when changing anything in
   `src/renderer/editor/markdown/` or `src/shared/markover-codec/`.
2. **Playwright e2e** (`tests/e2e/`): drives the packaged Electron app.
   First run rebuilds with `MARKOVER_TEST_BUILD=1` so the `EnableNodeCliInspectArguments`
   fuse is on (Playwright cannot attach otherwise). The fixture sets
   `MARKOVER_E2E_TEST=1` in the launched process and passes
   `--markover-e2e-test` via webPreferences.additionalArguments so the
   renderer can skip the beforeunload guard during teardown.

## Architecture

**Three-process Electron architecture:**

- **Main process** (`src/main/main.ts`): Window management, file I/O, IPC handlers, spell check config, PDF export via `printToPDF()`
- **Preload** (`src/main/preload.ts`): Context bridge exposing `electronAPI` to renderer with context isolation
- **Renderer** (`src/renderer/`): React app with TipTap editor

**Vite build gotcha:** Vite inlines `process.env` as `{}` in the preload and renderer bundles. To pass a runtime flag from main → preload → renderer, use `webPreferences.additionalArguments: ['--my-flag']` and read it via `process.argv.includes(...)` in the preload. The existing `--markover-e2e-test` plumbing in `main.ts`/`preload.ts` is the reference pattern.

**Toolbar button callbacks must refocus the editor.** Buttons that route through `editor.chain().focus().toggleX()` get this for free. Buttons that go through app-level callbacks (e.g. Track Changes, which updates a Zustand store) must call `editor?.commands.focus()` explicitly — otherwise the next keyboard action lands on the button, not the editor.

**Key data flow:** User edits → TipTap editor → markdown serialization → Markover codec injects metadata as HTML comments → IPC → main process file I/O.

### Editor Layer

`src/renderer/editor/use-editor.ts` — Custom hook that configures TipTap with 15+ extensions and handles markdown ↔ HTML conversion plus metadata parsing/serialization.

Custom TipTap extensions live in `src/renderer/editor/extensions/` (KaTeX inline/block, Mermaid, footnotes, front matter, image drop, comment highlights, track change insert/delete marks, and the track-changes ProseMirror plugin).

Markdown conversion: `src/renderer/editor/markdown/parser.ts` (markdown-it → HTML) and `serializer.ts` (ProseMirror → markdown).

Conventions baked into the serializer (don't regress these — there are tests for them):
- Italics use `_..._`, not `*...*` (avoids ambiguity with `**bold**`; set in commit `0aa6da0`)
- Empty top-level paragraphs are skipped (artifacts of block extraction from `<p>` wrappers)
- Blockquote `hardBreak` nodes don't emit trailing `  ` — the parser re-adds the hard break on load
- A list is "loose" only if any item contains more than one non-empty paragraph (nested lists don't make the parent loose)

### Markover Codec (`src/shared/markover-codec/`)

Custom file format that round-trips metadata (comments, highlights, track changes) through HTML comments embedded in markdown files. Pattern: `<!-- markover:type attrs -->` / `<!-- /markover:type -->`. Has its own schema, parser, serializer, and validator.

### State Management

Three Zustand stores:
- `src/renderer/store/editor-store.ts` — file path, dirty flag, word/cursor stats
- `src/renderer/collaboration/comments/comment-store.ts` — comment threads and replies
- `src/renderer/collaboration/track-changes/track-changes-store.ts` — tracked insertions/deletions

### IPC Types

`src/shared/types/ipc.ts` defines all IPC channel names and the `ElectronAPI` interface shared between main and renderer.

## Versioning

When bumping the version, update **all four locations** — they must stay in sync:

1. `package.json` — `"version"` field (use `npm version X.Y.Z --no-git-tag-version`)
2. `package-lock.json` — updated automatically by `npm version`
3. `forge.config.ts` — `packagerConfig.appVersion` (hardcoded string, must be updated manually)
4. `CHANGELOG.md` — add a new section at the top under the title, following the format of prior entries (link, date, Added/Fixed/Internal subsections)

The auto-updater (`update-electron-app`) reads the version from the packaged binary, which comes from `forge.config.ts`. If `forge.config.ts` is out of sync the installed app will never see the new release as an update.

Publish workflow:
1. Bump all four locations above, commit (`chore: bump version to X.Y.Z`), push
2. `GITHUB_TOKEN=$(gh auth token) npm run publish` — packages, makes a Squirrel installer, uploads to a draft GitHub release
3. `gh release edit vX.Y.Z --repo wetware0/markover --draft=false` — publish the release

## Progress Tracking

See `progress.json` for task status across all phases. Update it when completing or starting work.

## Tech Stack

TypeScript (strict), React 19, TipTap 3, Zustand, Vite, Electron Forge, Tailwind CSS 4, markdown-it, KaTeX, Mermaid, Shiki/Lowlight, Lucide icons.
