# Image Resolution and OS Username Default — Design

## Context

Markover is used to edit WTG.CuratedContent markdown files, which are part of a git repository and contain images referenced as **relative paths** (e.g. `../../../../_images/Domain/Path/image.png`). The editor must also support root-relative and absolute paths for general use.

Images are currently broken because `MarkoverImage` sets `img.src` directly from the ProseMirror node attribute. In dev mode, Electron serves the renderer from `http://localhost` (Vite dev server), so `file://` protocol is blocked by CORS. In prod mode, relative paths resolve against the app's HTML page URL rather than the markdown file's directory.

## Feature 1: Image Path Resolution

### Approach

Register a privileged custom Electron protocol `markover-asset:` in the main process. The renderer converts any local image `src` into a `markover-asset://?src=<encoded>` URL. The main process protocol handler decodes the raw `src`, resolves it to an absolute filesystem path, and serves the file via `net.fetch('file://...')`.

This approach works in both dev and prod because the custom scheme bypasses CORS entirely.

### Path Resolution Logic (main process)

Given raw `src` from the markdown:

1. **Already a URL** (`data:`, `http:`, `https:`, `file:`) — renderer uses as-is; does not use this protocol
2. **Windows absolute path** (`C:\...` or `C:/...`) — serve directly
3. **Root-relative** (starts with `/`) — try `path.join(gitRoot, src)` first; if that file does not exist, try as absolute filesystem path (`src` as-is)
4. **Relative** (everything else) — resolve against `path.dirname(currentFilePath)`; if no file is open, return 404

Git root is determined by running `git -C <fileDir> rev-parse --show-toplevel` on demand (cached per directory).

### Protocol Registration

`protocol.registerSchemesAsPrivileged` must be called before `app.ready`. The scheme needs `{ secure: true, supportFetchAPI: true }` privileges.

### Renderer Changes

In `MarkoverImage.addNodeView()`, before setting `img.src`:

```
if src is a URL (data:, http:, https:, file:) → use as-is
else → img.src = 'markover-asset://?src=' + encodeURIComponent(src)
```

### Primary Use Case

WTG.CuratedContent images are always relative paths. The relative resolution path is the critical one. Root-relative and absolute support handles other content.

---

## Feature 2: OS Username Default

The `user-store.ts` defaults `name: ''`. The first time a user runs Markover, the persisted name is empty, so comments and tracked changes are attributed to "User" instead of their real name.

### Approach

1. Add `GET_OS_USERNAME` IPC channel in main process, returning `os.userInfo().username`
2. Expose as `getOsUsername(): Promise<string>` via preload context bridge
3. In `App.tsx`, one-time `useEffect`: if `userName.trim()` is empty, call `getOsUsername()` and call `setName(username)`

The persisted name is loaded synchronously by Zustand's `persist` middleware before the effect runs, so users who have already set a name are not affected.

---

## Files Changed

| File | Change |
|---|---|
| `src/shared/types/ipc.ts` | Add `GET_OS_USERNAME` to `IPC_CHANNELS`; add `getOsUsername` to `ElectronAPI` |
| `src/main/main.ts` | `registerSchemesAsPrivileged` before ready; register `markover-asset:` protocol handler with path resolution and git root helper; add `GET_OS_USERNAME` handler |
| `src/main/preload.ts` | Expose `getOsUsername` |
| `src/renderer/editor/extensions/image-editable.ts` | Convert `src` to `markover-asset:` URL in `addNodeView()` |
| `src/renderer/components/App.tsx` | One-time `useEffect` to init username from OS if empty |
