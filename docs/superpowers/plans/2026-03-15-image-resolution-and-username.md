# Image Resolution and OS Username Default — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix local image rendering by resolving relative/root-relative/absolute paths via a custom Electron protocol, and default the author name to the OS login username on first launch.

**Architecture:** A privileged `markover-asset:` Electron protocol is registered in the main process, which resolves image paths using the currently open file's directory and git root. The renderer converts any local `src` attribute to a `markover-asset://?src=<encoded>` URL before rendering. OS username is exposed via a single IPC handler and applied once at startup if the persisted name is empty.

**Tech Stack:** Electron 41 (`protocol.handle`, `net.fetch`), Node.js `os.userInfo()`, `child_process.execFile` for git, TypeScript, React/Zustand.

---

## Chunk 1: IPC types and OS username wiring

### Task 1: Extend IPC types

**Files:**
- Modify: `src/shared/types/ipc.ts`

- [ ] **Step 1: Add `GET_OS_USERNAME` channel and `getOsUsername` to `ElectronAPI`**

  Open `src/shared/types/ipc.ts`. Add to `IPC_CHANNELS`:

  ```typescript
  GET_OS_USERNAME: 'os:get-username',
  ```

  Add to `ElectronAPI` interface:

  ```typescript
  getOsUsername: () => Promise<string>;
  ```

- [ ] **Step 2: Build to verify no type errors**

  Run: `npm run lint`
  Expected: No new errors (the new channel is just a string constant; new interface method has no implementation yet so no errors here).

---

### Task 2: Implement OS username in main process and preload

**Files:**
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Add `os` import to `main.ts`**

  At the top of `src/main/main.ts`, add:

  ```typescript
  import os from 'node:os';
  ```

- [ ] **Step 2: Add IPC handler for OS username**

  In `src/main/main.ts`, after the existing spellcheck IPC handlers (just before `app.on('ready', createWindow)`), add:

  ```typescript
  ipcMain.handle(IPC_CHANNELS.GET_OS_USERNAME, () => {
    try {
      return os.userInfo().username;
    } catch {
      return '';
    }
  });
  ```

- [ ] **Step 3: Expose via preload**

  In `src/main/preload.ts`, add to the `api` object:

  ```typescript
  getOsUsername: () => ipcRenderer.invoke(IPC_CHANNELS.GET_OS_USERNAME),
  ```

- [ ] **Step 4: Build to verify no type errors**

  Run: `npm run lint`
  Expected: No errors.

---

### Task 3: Initialize username in App on first launch

**Files:**
- Modify: `src/renderer/components/App.tsx`

- [ ] **Step 1: Add username init effect**

  In `src/renderer/components/App.tsx`, the store is already destructured as:
  ```typescript
  const { name: userName } = useUserStore();
  ```
  Change this line to also pull `setName`:
  ```typescript
  const { name: userName, setName } = useUserStore();
  ```

  Then add the following `useEffect` directly after the existing F1 keyboard handler effect (around line 62):

  ```typescript
  // Seed author name from OS login on first launch (only if no name persisted)
  useEffect(() => {
    if (!userName.trim()) {
      window.electronAPI.getOsUsername()
        .then((username) => { if (username) setName(username); })
        .catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  ```

  The empty deps array is intentional — this runs exactly once on mount. The ESLint comment suppresses the exhaustive-deps warning for this deliberate pattern.

- [ ] **Step 2: Build and verify**

  Run: `npm run lint`
  Expected: No errors.

- [ ] **Step 3: Manual smoke test**

  Run: `npm start`
  - Open **User Settings** (toolbar avatar button)
  - Verify the name field is pre-filled with your OS username (e.g. `peter`)
  - Clear the name, close and reopen the app — verify name is still blank (the effect only fills when empty, respecting user's choice to clear)

- [ ] **Step 4: Commit**

  ```bash
  git add src/shared/types/ipc.ts src/main/main.ts src/main/preload.ts src/renderer/components/App.tsx
  git commit -m "feat: default author name to OS username on first launch"
  ```

---

## Chunk 2: Image path resolution via custom Electron protocol

### Task 4: Register `markover-asset:` as a privileged scheme

**Files:**
- Modify: `src/main/main.ts`

> **Why privileged?** `protocol.registerSchemesAsPrivileged` must be called before `app.ready` fires. A privileged scheme with `secure: true` allows the renderer to fetch it from both dev (http://localhost) and prod (file://) origins without CORS errors.

- [ ] **Step 1: Add `protocol` and `net` to the Electron import**

  In `src/main/main.ts`, update the top import:

  ```typescript
  import { app, BrowserWindow, ipcMain, dialog, Menu, session, protocol, net } from 'electron';
  ```

- [ ] **Step 2: Add `child_process` imports for git root detection**

  After the Node.js imports (`path`, `fs`), add:

  ```typescript
  import { execFile } from 'node:child_process';
  import { promisify } from 'node:util';

  const execFileAsync = promisify(execFile);
  ```

- [ ] **Step 3: Register the privileged scheme (before `app.ready`)**

  Add this block immediately after all imports and before any other code (at module top-level, before the `if (started)` squirrel check):

  ```typescript
  // Must be called before app.ready
  protocol.registerSchemesAsPrivileged([
    { scheme: 'markover-asset', privileges: { secure: true, supportFetchAPI: true } },
  ]);
  ```

- [ ] **Step 4: Build to verify no type errors**

  Run: `npm run lint`
  Expected: No errors.

---

### Task 5: Implement the protocol handler

**Files:**
- Modify: `src/main/main.ts`

- [ ] **Step 1: Add the git root helper function with directory cache**

  Add these declarations after the `execFileAsync` declaration (near the top of the file, after imports). The cache avoids spawning a `git` subprocess for every image when many images share the same directory.

  ```typescript
  const gitRootCache = new Map<string, string | null>();

  async function getGitRoot(dir: string): Promise<string | null> {
    if (gitRootCache.has(dir)) return gitRootCache.get(dir)!;
    try {
      const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', '--show-toplevel']);
      const root = stdout.trim();
      gitRootCache.set(dir, root);
      return root;
    } catch {
      gitRootCache.set(dir, null);
      return null;
    }
  }
  ```

- [ ] **Step 2: Register the protocol handler in `app.on('ready', ...)`, not inside `createWindow`**

  > **Why not inside `createWindow`?** On macOS, `createWindow` is called again when the user clicks the dock icon after all windows are closed (`app.on('activate', ...)`). Calling `protocol.handle` a second time for the same scheme throws an error. Moving it to the `ready` callback ensures it runs exactly once.

  Replace the existing `app.on('ready', createWindow)` line at the bottom of `src/main/main.ts` with:

  ```typescript
  app.on('ready', () => {
    protocol.handle('markover-asset', async (request) => {
      const url = new URL(request.url);
      const rawSrc = decodeURIComponent(url.searchParams.get('src') ?? '');
      if (!rawSrc) return new Response('Missing src parameter', { status: 400 });

      let absolutePath: string;

      // Windows absolute path: C:\ or C:/
      if (/^[A-Za-z]:[/\\]/.test(rawSrc)) {
        absolutePath = rawSrc.replace(/\\/g, '/');
      } else if (rawSrc.startsWith('/')) {
        // Root-relative: try git root of the open file first.
        // On Windows, a bare /path has no drive letter so filesystem-absolute
        // resolution is meaningless — git root is the only sensible fallback.
        // On Unix, if the git root candidate doesn't exist, fall back to
        // filesystem absolute.
        const fileDir = currentFilePath ? path.dirname(currentFilePath) : null;
        const gitRoot = fileDir ? await getGitRoot(fileDir) : null;
        if (gitRoot) {
          const candidate = path.join(gitRoot, rawSrc);
          try {
            await fs.access(candidate);
            absolutePath = candidate.replace(/\\/g, '/');
          } catch {
            if (process.platform === 'win32') {
              // No meaningful filesystem-absolute fallback on Windows
              return new Response('Asset not found', { status: 404 });
            }
            // Unix: try as filesystem absolute
            absolutePath = rawSrc;
          }
        } else {
          if (process.platform === 'win32') {
            return new Response('Asset not found', { status: 404 });
          }
          absolutePath = rawSrc;
        }
      } else {
        // Relative path — resolve against directory of the open file
        if (!currentFilePath) return new Response('No file is open', { status: 404 });
        absolutePath = path.join(path.dirname(currentFilePath), rawSrc).replace(/\\/g, '/');
      }

      const fileUrl = process.platform === 'win32'
        ? `file:///${absolutePath}`
        : `file://${absolutePath}`;

      try {
        return await net.fetch(fileUrl);
      } catch {
        return new Response('Asset not found', { status: 404 });
      }
    });

    void createWindow();
  });
  ```

- [ ] **Step 3: Build to verify no type errors**

  Run: `npm run lint`
  Expected: No errors.

---

### Task 6: Convert image `src` to `markover-asset:` URL in the renderer

**Files:**
- Modify: `src/renderer/editor/extensions/image-editable.ts`

- [ ] **Step 1: Add the `resolveImageSrc` helper**

  At the top of `src/renderer/editor/extensions/image-editable.ts`, before the `MarkoverImage` declaration, add:

  ```typescript
  /**
   * Convert a raw markdown image src to a URL the renderer can load.
   * - Already-resolved URLs (data:, http:, https:, file:) are used as-is.
   * - All local paths (relative, root-relative, absolute filesystem) are
   *   passed through the markover-asset: protocol so the main process can
   *   resolve them against the open file's directory and git root.
   */
  function resolveImageSrc(src: string): string {
    if (!src) return src;
    if (/^(data:|https?:|file:)/i.test(src)) return src;
    return 'markover-asset://?src=' + encodeURIComponent(src);
  }
  ```

- [ ] **Step 2: Apply `resolveImageSrc` in `addNodeView`**

  In the `addNodeView()` method, change:

  ```typescript
  img.src = (node.attrs.src as string) || '';
  ```

  to:

  ```typescript
  img.src = resolveImageSrc((node.attrs.src as string) || '');
  ```

- [ ] **Step 3: Build to verify no type errors**

  Run: `npm run lint`
  Expected: No errors.

---

### Task 7: Manual verification and commit

- [ ] **Step 1: Test relative image paths**

  Run: `npm start`
  - Open a markdown file from `C:\git\WTG.CuratedContent` (any guide that references images, e.g. `Customs/Guides/Foundation/IndustryFoundation.md`)
  - Verify images render correctly in the editor

- [ ] **Step 2: Test with a newly created file containing a relative image reference**

  - Create a test markdown file in any directory, e.g. `C:\temp\test.md`
  - Add a line like `![](subfolder/image.png)` and place an actual image at `C:\temp\subfolder\image.png`
  - Open the file in Markover — verify the image renders

- [ ] **Step 3: Test that data: URIs still work (drag-and-drop)**

  - Drag an image file into the editor — it should render as a base64 data URI (handled by `ImageDrop` extension, unaffected by this change)

- [ ] **Step 4: Commit**

  ```bash
  git add src/main/main.ts src/renderer/editor/extensions/image-editable.ts
  git commit -m "feat: resolve local image paths via markover-asset: protocol"
  ```
