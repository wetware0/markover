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
```

No test framework is configured.

## Architecture

**Three-process Electron architecture:**

- **Main process** (`src/main/main.ts`): Window management, file I/O, IPC handlers, spell check config, PDF export via `printToPDF()`
- **Preload** (`src/main/preload.ts`): Context bridge exposing `electronAPI` to renderer with context isolation
- **Renderer** (`src/renderer/`): React app with TipTap editor

**Key data flow:** User edits → TipTap editor → markdown serialization → Markover codec injects metadata as HTML comments → IPC → main process file I/O.

### Editor Layer

`src/renderer/editor/use-editor.ts` — Custom hook that configures TipTap with 15+ extensions and handles markdown ↔ HTML conversion plus metadata parsing/serialization.

Custom TipTap extensions live in `src/renderer/editor/extensions/` (KaTeX inline/block, Mermaid, footnotes, front matter, image drop, comment highlights, track change insert/delete marks, and the track-changes ProseMirror plugin).

Markdown conversion: `src/renderer/editor/markdown/parser.ts` (markdown-it → HTML) and `serializer.ts` (ProseMirror → markdown).

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

When bumping the version, update **all three locations** — they must stay in sync:

1. `package.json` — `"version"` field (use `npm version X.Y.Z --no-git-tag-version`)
2. `package-lock.json` — updated automatically by `npm version`
3. `forge.config.ts` — `packagerConfig.appVersion` (hardcoded string, must be updated manually)

The auto-updater (`update-electron-app`) reads the version from the packaged binary, which comes from `forge.config.ts`. If `forge.config.ts` is out of sync the installed app will never see the new release as an update.

## Progress Tracking

See `progress.json` for task status across all phases. Update it when completing or starting work.

## Tech Stack

TypeScript (strict), React 19, TipTap 3, Zustand, Vite, Electron Forge, Tailwind CSS 4, markdown-it, KaTeX, Mermaid, Shiki/Lowlight, Lucide icons.
