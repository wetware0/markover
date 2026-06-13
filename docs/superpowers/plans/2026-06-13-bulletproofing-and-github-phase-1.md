# Markover Bulletproofing + GitHub Integration Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the two open GitHub issues, close the security and data-safety gaps that put a non-developer's work at risk, harden the file-format codec, and add a GitHub sign-in + Open/Save-from-GitHub capability that needs no git binary and no merge-conflict vocabulary.

**Architecture:** Markover is a three-process Electron app (main = `src/main/`, preload = `src/main/preload.ts`, renderer React app = `src/renderer/`). Markdown ↔ HTML conversion lives in `src/renderer/editor/markdown/`; the custom file-format codec lives in `src/shared/markover-codec/`. The fastest correctness feedback loop is the headless roundtrip harness (`npx tsx scripts/roundtrip-test.ts`), which exercises the real parser + serializer + codec under JSDOM in ~3s. GitHub access uses the **GitHub REST API directly via OAuth device flow** — no local git, no clone, no working tree — so the failure modes that make git unusable for non-developers never appear.

**Tech Stack:** TypeScript (strict), Electron 41, React 19, TipTap 3 (ProseMirror), markdown-it, Zustand, Tailwind 4, Vite, Playwright. GitHub work uses Electron `safeStorage` (token at rest) and the global `fetch` available in the Electron main process (Node 18+).

**How to run the test loops:**
- Headless roundtrip/codec suite: `npx tsx scripts/roundtrip-test.ts` (exit code 1 on any failure)
- Lint: `npm run lint`
- E2E (slow, rebuilds a test package on first run): `npm test`

**Conventions you must not regress** (there are tests for these): italics serialize as `_..._`; empty top-level paragraphs are skipped; a list is "loose" only if an item has more than one non-empty paragraph. See `CLAUDE.md`.

**Commit discipline:** One commit per task (or per logical step where noted). Never use `--no-verify`. Co-author every commit:
```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## File Structure

**Phase 1–2 (bug + security)** modify existing files only:
- `src/renderer/editor/markdown/parser.ts` — task-list handling (rewrite the approach)
- `scripts/roundtrip-test.ts` — new test cases
- `src/renderer/editor/extensions/mermaid-block.ts` — XSS error-path fix
- `package.json` / `package-lock.json` — Mermaid version bump
- `src/main/main.ts` — asset-protocol scoping, shell-open guard

**Phase 3 (data safety)** adds a renderer notification primitive and hardens main-process I/O:
- Create: `src/renderer/ui/toast/toast-store.ts`, `src/renderer/ui/toast/ToastHost.tsx`
- Modify: `src/main/main.ts` (atomic save, mtime tracking), `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/renderer/components/App.tsx`

**Phase 4 (codec robustness)** modifies the codec and its tests:
- `src/shared/markover-codec/serializer.ts`, `parser.ts`, `validator.ts`
- `scripts/roundtrip-test.ts` (codec edge-case cases)

**Phase 5 (track-changes integrity)**:
- `src/renderer/editor/extensions/track-changes-plugin.ts`, `src/renderer/components/App.tsx`

**Phase 6 (GitHub Phase 1)** adds an isolated GitHub subsystem:
- Create (main): `src/main/github/auth.ts`, `src/main/github/api.ts`, `src/main/github/token-store.ts`, `src/main/github/ipc.ts`
- Create (renderer): `src/renderer/github/github-store.ts`, `src/renderer/github/GitHubSignInDialog.tsx`, `src/renderer/github/OpenFromGitHubDialog.tsx`
- Modify: `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/main/main.ts` (register handlers), `src/renderer/components/App.tsx`, `src/main/menu.ts`

---

# PHASE 1 — Correctness bugs (the two open GitHub issues)

## Task 1: Fix task-list parsing for formatted, nested, and loose items (issue #22)

**Root cause (verified by reproduction):** `parser.ts` uses `markdown-it-task-lists` with `label: true, labelAfter: true`, then rewrites the rendered HTML with a regex (lines 147–154). Two compounding bugs: (a) the plugin emits an *unclosed* `<strong>` plus duplicated raw `**...**` text when a task label contains inline formatting; (b) the regex requires `</label>` to be immediately followed by `</li>`, so it silently fails to convert any task item that contains a nested sub-list or is part of a loose list — leaving `class="task-list-item"` items that TipTap's TaskList schema cannot place.

**Fix approach:** Stop post-processing rendered HTML. Drop the `label` options and add a markdown-it **core rule** that runs after `markdown-it-task-lists` and rewrites the *token stream* into TipTap's expected shape (`<ul data-type="taskList">` / `<li data-type="taskItem" data-checked="...">` with a real `<p>` inside). Token-level rewriting respects nesting and loose/tight automatically because the default renderer recurses.

**Files:**
- Modify: `src/renderer/editor/markdown/parser.ts:11` (plugin options) and `:143-154` (delete regex block); add a new core rule near the other `md.core.ruler` calls (around `:33`)
- Test: `scripts/roundtrip-test.ts` (add cases to the `cases` array near the existing task-list cases, ~`:189`)

- [ ] **Step 1: Write the failing tests**

Add these to the `cases` array in `scripts/roundtrip-test.ts` (next to the existing `task list` case ~line 189):

```ts
  {
    name: 'task list with bold label (issue #22)',
    input: '- [ ] **Task 1: Project scaffold**\n',
  },
  {
    name: 'task list with bold label and nested bullets (issue #22)',
    input: '- [ ] **Task 1: Project scaffold**\n  - Create the solution\n  - Add refs\n',
  },
  {
    name: 'two bold tasks each with nested bullets (issue #22)',
    input:
      '- [ ] **Task 1: Scaffold**\n  - Create solution\n\n- [ ] **Task 2: Settings**\n  - POCO with defaults\n',
  },
  {
    name: 'task list with inline code label',
    input: '- [ ] configure `settings.json`\n',
  },
  {
    name: 'mixed checked/unchecked with formatting',
    input: '- [x] **done** item\n- [ ] _todo_ item\n',
  },
```

- [ ] **Step 2: Run the harness to confirm these fail**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: the five new cases appear under `FAIL` (output will show duplicated `**...**` text and/or unclosed bold). Note the current pass count so you can confirm no regressions later.

- [ ] **Step 3: Change the plugin options**

In `src/renderer/editor/markdown/parser.ts`, change line 11 from:

```ts
  .use(taskLists, { enabled: true, label: true, labelAfter: true })
```
to:
```ts
  .use(taskLists, { enabled: true })
```

- [ ] **Step 4: Add the token-rewrite core rule**

In `src/renderer/editor/markdown/parser.ts`, after the existing `recover_malformed_strong_with_boundary_space` rule (after line 62), add:

```ts
// markdown-it-task-lists tags task list tokens (class "contains-task-list" on the
// <ul>, class "task-list-item" on each <li>) and injects an html_inline checkbox
// token as the first child of the item's inline content. TipTap's TaskList/TaskItem
// extensions instead want <ul data-type="taskList"> and
// <li data-type="taskItem" data-checked="true|false"><p>…</p></li>.
// Rewrite the token stream (not the rendered HTML) so nested and loose task lists
// — which the old regex approach mangled — convert correctly.
md.core.ruler.after('inline', 'markover_task_items', (state) => {
  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    if (tok.type === 'bullet_list_open' && /\bcontains-task-list\b/.test(tok.attrGet('class') || '')) {
      tok.attrSet('data-type', 'taskList');
      continue;
    }

    if (tok.type === 'list_item_open' && /\btask-list-item\b/.test(tok.attrGet('class') || '')) {
      const paraOpen = tokens[i + 1];
      const inline = tokens[i + 2];
      const paraClose = tokens[i + 3];
      let checked = false;

      if (inline && inline.type === 'inline' && inline.children && inline.children.length) {
        const first = inline.children[0];
        if (first.type === 'html_inline' && /task-list-item-checkbox/.test(first.content)) {
          checked = /\bchecked\b/.test(first.content);
          inline.children.shift(); // drop the raw <input> token
          // The plugin leaves a single leading space where the marker was.
          const nextChild = inline.children[0];
          if (nextChild && nextChild.type === 'text') {
            nextChild.content = nextChild.content.replace(/^\s/, '');
          }
        }
      }

      tok.attrSet('data-type', 'taskItem');
      tok.attrSet('data-checked', checked ? 'true' : 'false');

      // Tight lists hide the wrapping <p>; force a real paragraph so TipTap sees
      // block content inside the task item.
      if (paraOpen && paraOpen.type === 'paragraph_open') paraOpen.hidden = false;
      if (paraClose && paraClose.type === 'paragraph_close') paraClose.hidden = false;
    }
  }
});
```

- [ ] **Step 5: Delete the now-obsolete HTML regex rewrite**

In `src/renderer/editor/markdown/parser.ts`, delete the entire task-list rewrite block (the comment plus the two `html = html.replace(...)` calls, currently lines 143–154):

```ts
  // markdown-it-task-lists emits <ul class="contains-task-list"><li class="task-list-item">
  // ... (delete through) ...
  html = html.replace(
    /<li class="task-list-item[^"]*">\s*<input class="task-list-item-checkbox"([^>]*)>\s*<label[^>]*>([\s\S]*?)<\/label>\s*<\/li>/g,
    (_, inputAttrs: string, labelContent: string) => {
      const checked = /\bchecked\b/.test(inputAttrs) ? 'true' : 'false';
      return `<li data-type="taskItem" data-checked="${checked}"><p>${labelContent.trim()}</p></li>`;
    },
  );
```

- [ ] **Step 6: Run the harness; iterate until green**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: all five new cases PASS, and the previously-passing task-list cases (`task list`, `task list with multi-word labels`) still PASS, with the same total pass count as before plus 5.

If a nested-task case fails on the *serializer* side (the round-trip output drops or mis-indents the nested bullets), fix `src/renderer/editor/markdown/serializer.ts:316` `taskList` handler so nested non-paragraph children render with correct indentation, then re-run. Do not change the parser rule to compensate for a serializer bug.

- [ ] **Step 7: Add the issue's real sample as a regression fixture**

Download the file attached to issue #22 is not required; the `two bold tasks each with nested bullets` case already reproduces it. Confirm the issue's exact text shape (bold task heading + indented sub-bullets, blank line between tasks) is covered. If not, add one more case mirroring it.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint
git add src/renderer/editor/markdown/parser.ts scripts/roundtrip-test.ts src/renderer/editor/markdown/serializer.ts
git commit -m "fix(parser): correctly handle task lists with formatting and nesting (#22)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Patch Mermaid vulnerabilities and fix the XSS error path (issue #16)

**Context:** Issue #16 lists four Dependabot advisories against `mermaid` (CSS injection via config and `classDefs`, HTML injection via `classDef` in state diagrams, Gantt infinite-loop DoS). Separately, `mermaid-block.ts:64` injects raw diagram source via `innerHTML` on the render-error path — an XSS sink. Both must be fixed together because the HTML-injection advisory means even Mermaid's "safe" SVG output is only as safe as the installed version.

**Files:**
- Modify: `package.json` (and `package-lock.json` via npm) — `mermaid` version
- Modify: `src/renderer/editor/extensions/mermaid-block.ts:64`

- [ ] **Step 1: Find the fixed Mermaid version**

Run: `npm audit --json | npx --yes json -ga vulnerabilities.mermaid 2>/dev/null || npm audit`
Then check the GitHub advisories linked in issue #16. Identify the lowest `mermaid` 11.x release that resolves all four advisories (check https://github.com/mermaid-js/mermaid/releases).
Expected: a concrete version, e.g. `11.x.y`.

- [ ] **Step 2: Bump Mermaid**

Run (substitute the version from Step 1):
```bash
npm install mermaid@^11.X.Y --legacy-peer-deps
```
Expected: `package.json` `dependencies.mermaid` updated; `package-lock.json` updated.

- [ ] **Step 3: Verify the advisories are cleared**

Run: `npm audit`
Expected: the four Mermaid advisories from issue #16 no longer appear. If any remain, bump to the next patched release and re-run.

- [ ] **Step 4: Fix the XSS error path**

In `src/renderer/editor/extensions/mermaid-block.ts`, replace the `catch` block (line 63–65):

```ts
        } catch {
          dom.innerHTML = `<pre class="mermaid-error">${code}</pre>`;
        }
```
with:
```ts
        } catch {
          dom.replaceChildren();
          const pre = document.createElement('pre');
          pre.className = 'mermaid-error';
          pre.textContent = code; // textContent — never innerHTML — so diagram source can't inject markup
          dom.appendChild(pre);
        }
```

- [ ] **Step 5: Sanity-check rendering still works**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: the `mermaid block` case still PASSES (serialization is unaffected by the runtime render path). The error-path change is exercised manually in Step 6.

- [ ] **Step 6: Manual smoke test**

Run: `npm start`. Type a fenced ```` ```mermaid ```` block with valid content (`graph TD\nA-->B`) — confirm it renders. Then type an invalid one containing markup (e.g. ```` ```mermaid ````, body `<img src=x onerror=alert(1)>`) — confirm the source is shown as plain text in a `.mermaid-error` block and **no alert fires**.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/editor/extensions/mermaid-block.ts
git commit -m "fix(security): patch Mermaid advisories and escape mermaid error output (#16)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE 2 — Security hardening

## Task 3: Scope the `markover-asset` protocol to the open document's directory tree

**Context:** `src/main/main.ts:418-470` serves *any* file the renderer requests via `markover-asset://?src=…`, including absolute paths anywhere on disk, with `supportFetchAPI: true`. Combined with any renderer-side HTML injection this becomes local-file exfiltration. Restrict served files to the open document's directory (and its git root, which is already the resolution base for root-relative paths).

**Files:**
- Modify: `src/main/main.ts:418-470` (the `protocol.handle('markover-asset', …)` body)

- [ ] **Step 1: Add a containment check helper**

In `src/main/main.ts`, just above `app.on('ready', …)` (line 417), add:

```ts
// True if `candidate` is inside `root` (after normalisation). Prevents the
// asset protocol from serving files outside the document's directory tree.
function isPathInside(candidate: string, root: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
```

- [ ] **Step 2: Enforce containment before fetching**

In the `markover-asset` handler, after `absolutePath` is resolved (just before the `const fileUrl = …` line, ~line 461), insert:

```ts
    // Containment: only serve assets within the open document's directory or its
    // git root. Without an open file there is no legitimate asset to serve.
    const docDir = currentFilePath ? path.dirname(currentFilePath) : null;
    if (!docDir) return new Response('No file is open', { status: 404 });
    const gitRoot = await getGitRoot(docDir);
    const allowedRoots = [docDir.replace(/\\/g, '/'), gitRoot?.replace(/\\/g, '/')].filter(Boolean) as string[];
    const normalised = path.resolve(absolutePath).replace(/\\/g, '/');
    if (!allowedRoots.some((root) => isPathInside(normalised, root))) {
      return new Response('Asset outside document directory', { status: 403 });
    }
```

- [ ] **Step 3: Manual verification**

Run `npm start`, open a markdown file that references a local image with a relative path (`![](./pic.png)`), confirm it still renders. Then craft a doc referencing `../../../some/other/file` and confirm it is **not** served (image broken, 403 in devtools network panel).

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add src/main/main.ts
git commit -m "fix(security): restrict markover-asset protocol to the document directory tree

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Confirm before launching executable files via `shell:open-path`

**Context:** `src/main/main.ts:395-415` calls `shell.openPath` on whatever target the renderer passes (file attachments / links). A malicious document could link to a bundled `.exe`/`.bat`/`.cmd`/`.ps1`/`.msi`/`.scr` and trick a non-developer into launching it. Add a confirmation dialog for executable extensions.

**Files:**
- Modify: `src/main/main.ts:395-415` (the `SHELL_OPEN_PATH` handler)

- [ ] **Step 1: Add the guard**

In the `SHELL_OPEN_PATH` handler, replace the final `void shell.openPath(absolutePath);` (line 414) with:

```ts
  const EXECUTABLE_RE = /\.(exe|bat|cmd|com|scr|ps1|msi|vbs|js|jar|app|sh)$/i;
  if (EXECUTABLE_RE.test(absolutePath)) {
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Open', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Open an executable file?',
      detail: `This will run:\n${absolutePath}\n\nOnly continue if you trust this document.`,
    });
    if (response !== 0) return;
  }
  void shell.openPath(absolutePath);
```

Make the handler `async` if it is not already (change `(_event, target: string) =>` to `async (_event, target: string) =>`).

- [ ] **Step 2: Manual verification**

Run `npm start`, drag a `.txt` onto the editor and click it — opens with no prompt. Construct a link/attachment to a `.bat`/`.exe` and click it — confirm the warning dialog appears and Cancel prevents launch.

- [ ] **Step 3: Lint and commit**

```bash
npm run lint
git add src/main/main.ts
git commit -m "fix(security): confirm before opening executable files from a document

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE 3 — Data safety

## Task 5: Add a renderer toast/notification primitive

**Context:** There is currently no non-modal way to tell the user anything ("Saved", "Save failed: …", "File changed on disk"). Several later tasks depend on this. Build a tiny Zustand-backed toast store + host component.

**Files:**
- Create: `src/renderer/ui/toast/toast-store.ts`
- Create: `src/renderer/ui/toast/ToastHost.tsx`
- Modify: `src/renderer/components/App.tsx` (mount `<ToastHost />`)

- [ ] **Step 1: Create the store**

Create `src/renderer/ui/toast/toast-store.ts`:

```ts
import { create } from 'zustand';
import { nanoid } from 'nanoid';

export type ToastKind = 'info' | 'success' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  show: (kind: ToastKind, message: string, ttlMs?: number) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (kind, message, ttlMs = 5000) => {
    const id = nanoid(8);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    if (ttlMs > 0) {
      setTimeout(() => get().dismiss(id), ttlMs);
    }
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Convenience helpers for non-component call sites.
export const toast = {
  info: (m: string) => useToastStore.getState().show('info', m),
  success: (m: string) => useToastStore.getState().show('success', m),
  error: (m: string, ttlMs = 0) => useToastStore.getState().show('error', m, ttlMs), // errors stick until dismissed
};
```

- [ ] **Step 2: Create the host component**

Create `src/renderer/ui/toast/ToastHost.tsx`:

```tsx
import React from 'react';
import { X } from 'lucide-react';
import { useToastStore } from './toast-store';

const KIND_CLASSES: Record<string, string> = {
  info: 'bg-gray-800 text-white',
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
};

export function ToastHost() {
  const { toasts, dismiss } = useToastStore();
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`flex items-start gap-2 rounded px-3 py-2 text-sm shadow-lg ${KIND_CLASSES[t.kind]}`}
        >
          <span className="flex-1 whitespace-pre-wrap">{t.message}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="opacity-70 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount it in App**

In `src/renderer/components/App.tsx`, add the import near the other UI imports (after line 27):
```tsx
import { ToastHost } from '../ui/toast/ToastHost';
```
Then add `<ToastHost />` just before the closing `</div>` of the top-level layout (the outermost `<div className="flex flex-col h-screen …">` returned by `App`, ~line 660 onward). Place it as the last child so it overlays everything.

- [ ] **Step 4: Verify it builds and renders**

Run: `npm run lint` (expect no errors). Run `npm start`; in the devtools console run `window` is fine — instead temporarily wire a test by adding `toast.success('hello')` is not necessary. Confirm the app starts with no console errors. (Real exercise happens in Task 7.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/ui/toast/toast-store.ts src/renderer/ui/toast/ToastHost.tsx src/renderer/components/App.tsx
git commit -m "feat(ui): add toast notification primitive

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Atomic file saves (write temp + fsync + rename)

**Context:** `src/main/main.ts:285-295` (`FILE_SAVE`) and `:310-318` (`FILE_SAVE_AS`) overwrite the target directly. A crash or disk-full mid-write truncates the file and the original is already gone. Replace direct writes with a same-directory temp file, fsync, then atomic rename.

**Files:**
- Modify: `src/main/main.ts` (add a helper; use it in both save handlers)

- [ ] **Step 1: Add an atomic-write helper**

In `src/main/main.ts`, after the imports / near `getGitRoot` (~line 25), add:

```ts
import { randomBytes } from 'node:crypto';

// Write atomically: a same-directory temp file is fsynced then renamed over the
// target, so a crash mid-write can never truncate the user's document.
async function atomicWrite(filePath: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${randomBytes(6).toString('hex')}.tmp`);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, filePath);
}
```

(If `randomBytes` import collides with existing imports, merge it into the existing `node:crypto` import or place it with the other `node:` imports at the top.)

- [ ] **Step 2: Use it in `FILE_SAVE`**

In the `FILE_SAVE` handler (line 287), replace `await fs.writeFile(filePath, content, 'utf-8');` with `await atomicWrite(filePath, content);`.

- [ ] **Step 3: Use it in `FILE_SAVE_AS` and the PDF export**

In `FILE_SAVE_AS` (line 311) replace `await fs.writeFile(result.filePath, content, 'utf-8');` with `await atomicWrite(result.filePath, content);`.
In `EXPORT_PDF` (line 344) replace `await fs.writeFile(result.filePath, pdfData);` with `await atomicWrite(result.filePath, pdfData);`.

- [ ] **Step 4: Manual verification**

Run `npm start`, open/create a document, save (`Ctrl+S`), confirm the file on disk has the content and **no `.tmp` files remain** in the directory. Save several times; confirm no leftover temp files.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/main/main.ts
git commit -m "fix(data-safety): write files atomically (temp + fsync + rename)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Surface save failures to the user

**Context:** Both save handlers swallow errors and return `{success: false}` with no reason; the renderer (`App.tsx:182-191`) silently does nothing on failure, so the user believes their work is saved when it is not. Return the error message and show it as a sticky toast.

**Files:**
- Modify: `src/shared/types/ipc.ts` (`SaveResult`)
- Modify: `src/main/main.ts` (`FILE_SAVE`, `FILE_SAVE_AS`)
- Modify: `src/renderer/components/App.tsx` (`handleSave`, `handleSaveAs`)

- [ ] **Step 1: Extend the result type**

In `src/shared/types/ipc.ts`, change `SaveResult` (lines 7-10) to:

```ts
export interface SaveResult {
  success: boolean;
  filePath: string;
  error?: string;
}
```

- [ ] **Step 2: Return the error from main**

In `src/main/main.ts` `FILE_SAVE` handler, change the `catch` (lines 292-294) to:
```ts
  } catch (err) {
    return { success: false, filePath, error: (err as Error).message };
  }
```
In `FILE_SAVE_AS`, change the `catch` (lines 316-318) to return a structured failure instead of `null`:
```ts
  } catch (err) {
    return { success: false, filePath: result.filePath, error: (err as Error).message };
  }
```

- [ ] **Step 3: Show the error in the renderer**

In `src/renderer/components/App.tsx`, add the import (near line 27):
```tsx
import { toast } from '../ui/toast/toast-store';
```
In `handleSave` (lines 182-191), update both branches:
```tsx
    if (filePath) {
      const result = await window.electronAPI.saveFile(filePath, content);
      if (result.success) {
        setDirty(false);
        toast.success('Saved');
      } else {
        toast.error(`Save failed: ${result.error ?? 'unknown error'}`);
      }
    } else {
      const result = await window.electronAPI.saveFileAs(content);
      if (result && result.success) {
        setFile(result.filePath, result.filePath.split(/[\\/]/).pop() || 'Untitled');
        setDirty(false);
        toast.success('Saved');
      } else if (result && result.error) {
        toast.error(`Save failed: ${result.error}`);
      }
    }
```
Apply the same success/error handling to `handleSaveAs` (lines 202-206).

- [ ] **Step 4: Verify**

Run `npm start`. Save a document normally — a green "Saved" toast appears. Then make the target read-only (e.g. open a file from a read-only location, or `chmod`/Properties → Read-only) and save — a sticky red "Save failed: …" toast appears with the OS error.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/shared/types/ipc.ts src/main/main.ts src/renderer/components/App.tsx
git commit -m "fix(data-safety): surface save failures to the user

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Detect external on-disk changes before overwriting

**Context:** Files synced by OneDrive/Dropbox/git can change on disk while open; Markover currently overwrites the newer version with no warning. Track the modified-time of the open file and refuse to overwrite a file that changed since we last read/wrote it, unless the user confirms.

**Files:**
- Modify: `src/main/main.ts` (track mtime on open/save; check before overwrite in `FILE_SAVE`)
- Modify: `src/shared/types/ipc.ts` (`saveFile` gains a `force` flag; `SaveResult` gains `conflict`)
- Modify: `src/main/preload.ts` (pass `force`)
- Modify: `src/renderer/components/App.tsx` (prompt on conflict)

- [ ] **Step 1: Track the last-known mtime in main**

In `src/main/main.ts`, add a module-level variable near `currentFilePath` (line 55):
```ts
let lastKnownMtimeMs: number | null = null;
```
In `openFileByPath` (after `const content = await fs.readFile(...)`, ~line 112) and in the `FILE_OPEN` handler (after its `readFile`, ~line 273), record the mtime:
```ts
    lastKnownMtimeMs = (await fs.stat(filePath)).mtimeMs;
```
(Use `result.filePaths[0]` for `FILE_OPEN`.)

- [ ] **Step 2: Check + update mtime in `FILE_SAVE`**

Change the `FILE_SAVE` handler signature and body to accept a `force` flag and detect conflicts:
```ts
ipcMain.handle(IPC_CHANNELS.FILE_SAVE, async (_event, filePath: string, content: string, force = false) => {
  try {
    if (!force && isSamePath(filePath, currentFilePath || '') && lastKnownMtimeMs !== null) {
      const onDisk = await fs.stat(filePath).then((s) => s.mtimeMs).catch(() => null);
      if (onDisk !== null && onDisk > lastKnownMtimeMs + 1) {
        return { success: false, filePath, conflict: true };
      }
    }
    await atomicWrite(filePath, content);
    lastKnownMtimeMs = (await fs.stat(filePath)).mtimeMs;
    currentFilePath = filePath;
    updateTitle();
    await addRecentFile(filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, filePath, error: (err as Error).message };
  }
});
```
Also update `lastKnownMtimeMs` at the end of `FILE_SAVE_AS` (after its `atomicWrite`): `lastKnownMtimeMs = (await fs.stat(result.filePath)).mtimeMs;`.

- [ ] **Step 3: Extend the IPC types**

In `src/shared/types/ipc.ts`, add `conflict?: boolean;` to `SaveResult`, and change the `saveFile` signature on `ElectronAPI`:
```ts
  saveFile: (filePath: string, content: string, force?: boolean) => Promise<SaveResult>;
```

- [ ] **Step 4: Pass `force` through preload**

In `src/main/preload.ts`, update `saveFile`:
```ts
  saveFile: (filePath: string, content: string, force?: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_SAVE, filePath, content, force),
```

- [ ] **Step 5: Prompt on conflict in the renderer**

In `App.tsx` `handleSave`, in the `filePath` branch, handle the conflict result before the generic error:
```tsx
      const result = await window.electronAPI.saveFile(filePath, content);
      if (result.success) {
        setDirty(false);
        toast.success('Saved');
      } else if (result.conflict) {
        const overwrite = window.confirm(
          'This file changed on disk since you opened it (it may have synced from another device). ' +
          'Overwrite the version on disk with your changes?',
        );
        if (overwrite) {
          const forced = await window.electronAPI.saveFile(filePath, content, true);
          if (forced.success) { setDirty(false); toast.success('Saved (overwrote disk version)'); }
          else toast.error(`Save failed: ${forced.error ?? 'unknown error'}`);
        }
      } else {
        toast.error(`Save failed: ${result.error ?? 'unknown error'}`);
      }
```

- [ ] **Step 6: Manual verification**

Run `npm start`, open a file. In a separate editor (Notepad/VS Code), modify and save that same file. Back in Markover, edit and `Ctrl+S` — confirm the conflict prompt appears; choosing Overwrite saves your version, Cancel leaves the disk version intact.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint
git add src/main/main.ts src/shared/types/ipc.ts src/main/preload.ts src/renderer/components/App.tsx
git commit -m "fix(data-safety): detect external on-disk changes before overwrite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE 4 — Codec robustness

## Task 9: Escape quotes in metadata attributes (round-trip safe)

**Context:** `serializer.ts:44-56` writes comment/author/date attributes with raw `"`; `parser.ts:144-151` reads them with `/(\w+)="([^"]*)"/`. An author named `John "JJ" Smith`, or any `"` in a date/status, breaks both. Escape on write, unescape on read.

**Files:**
- Modify: `src/shared/markover-codec/serializer.ts`
- Modify: `src/shared/markover-codec/parser.ts`
- Test: `scripts/roundtrip-test.ts`

- [ ] **Step 1: Write the failing test**

Add to the `cases` array in `scripts/roundtrip-test.ts` (in the markover codec section ~line 254):
```ts
  {
    name: 'comment with quotes in author name',
    input:
      'Body.\n\n<!-- markover:comment id="c1" author="John &quot;JJ&quot; Smith" date="2026-01-01" status="open" -->\nNote.\n<!-- /markover:comment -->\n',
  },
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: the new case FAILS (the author name is truncated at the first quote).

- [ ] **Step 3: Add escape/unescape helpers in the codec**

In `src/shared/markover-codec/serializer.ts`, add at the top (after imports):
```ts
function escAttr(v: string): string {
  return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}
```
Use `escAttr(...)` for every interpolated attribute value in `serializeComment` and `serializeFileMeta` (`comment.id`, `comment.author`, `comment.date`, `comment.status`, reply attrs, author `name`/`color`).

- [ ] **Step 4: Unescape on read**

In `src/shared/markover-codec/parser.ts`, change `parseAttrs` (lines 144-151) so each value is unescaped:
```ts
function unescAttr(v: string): string {
  return v.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

function parseAttrs(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrString)) !== null) {
    attrs[m[1]] = unescAttr(m[2]);
  }
  return attrs;
}
```
Also unescape the author name/color in `parseFileMeta` (the `.replace(/^"|"$/g, '')` lines, 175 & 177) by wrapping in `unescAttr(...)`.

- [ ] **Step 5: Run to confirm pass**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: the new case PASSES; all prior cases still pass.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint
git add src/shared/markover-codec/serializer.ts src/shared/markover-codec/parser.ts scripts/roundtrip-test.ts
git commit -m "fix(codec): escape quotes in metadata attributes for safe round-trip

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Validate offsets/overlaps and surface discarded metadata

**Context:** `validator.ts` checks duplicate IDs, orphans, and start>end, but never checks offsets against the actual clean-markdown length, so corrupted metadata can silently highlight the wrong text on reload. Add a bounds check and have the load path warn (via toast) when metadata is invalid rather than failing silently.

**Files:**
- Modify: `src/shared/markover-codec/validator.ts`
- Modify: `src/renderer/components/App.tsx` (the `onFileChanged` load path that calls `parseMarkoverFile` / `getMetadata`)

- [ ] **Step 1: Add a length-aware bounds check**

In `src/shared/markover-codec/validator.ts`, add an `out_of_bounds` error type to the `ValidationError['type']` union, and an optional `docLength` parameter:
```ts
export interface ValidationError {
  type: 'orphaned_highlight' | 'orphaned_comment' | 'missing_id' | 'duplicate_id' | 'invalid_range' | 'out_of_bounds';
  message: string;
  id?: string;
}

export function validateMetadata(metadata: MarkovMetadata, docLength?: number): ValidationError[] {
```
Then, inside the highlight/insertion/deletion loops, after the `start > end` check, add (using the same `id`):
```ts
    if (docLength !== undefined && (hl.endOffset > docLength || hl.startOffset < 0)) {
      errors.push({ type: 'out_of_bounds', message: `Highlight "${hl.id}" offset out of bounds`, id: hl.id });
    }
```
(Replicate for insertions/deletions with their own variable names.)

- [ ] **Step 2: Warn on invalid metadata at load time**

Find the load path in `App.tsx` (`onFileChanged` handler, ~line 538, and any `parseMarkoverFile` call). After metadata is parsed, validate and toast a single summary if there are errors:
```tsx
import { validateMetadata } from '../../shared/markover-codec';
// ...after parse, where you have `cleanMarkdown` and `metadata`:
const problems = validateMetadata(metadata, cleanMarkdown.length);
if (problems.length > 0) {
  toast.error(`This file's collaboration data had ${problems.length} issue(s) and may display incompletely.`);
}
```
(If `validateMetadata` is not re-exported from the codec index, add it to `src/shared/markover-codec/index.ts`.)

- [ ] **Step 3: Verify the export and build**

Run: `npm run lint`. Confirm no type errors. Run `npx tsx scripts/roundtrip-test.ts` to confirm no codec regressions.

- [ ] **Step 4: Commit**

```bash
git add src/shared/markover-codec/validator.ts src/shared/markover-codec/index.ts src/renderer/components/App.tsx
git commit -m "fix(codec): validate metadata offsets and warn on corrupt collaboration data

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: Codec malformed-input tests

**Context:** There are no tests for malformed metadata. Add cases that prove the codec degrades gracefully (does not throw) on broken input.

**Files:**
- Test: `scripts/roundtrip-test.ts`

- [ ] **Step 1: Add graceful-degradation cases**

Add to the `cases` array (these assert the codec does not throw and produces stable output; set `expected` to the clean text the parser should keep):
```ts
  {
    name: 'unmatched comment end marker is ignored',
    input: 'Body text.\n\n<!-- /markover:comment -->\n',
    expected: 'Body text.\n',
  },
  {
    name: 'comment block missing required attrs does not crash',
    input:
      'Body.\n\n<!-- markover:comment id="c1" -->\nOrphan note.\n<!-- /markover:comment -->\n',
  },
  {
    name: 'malformed file meta version falls back to 1',
    input: 'Body.\n\n<!-- markover:meta\nversion: abc\n-->\n',
    expected: 'Body.\n',
  },
```

- [ ] **Step 2: Run; fix any throw**

Run: `npx tsx scripts/roundtrip-test.ts`
Expected: cases PASS (no `THROWN:` output). If a case throws, harden the relevant parser function so malformed input degrades to a sensible default rather than throwing, then re-run. (The first/third cases assert the broken markers/values are stripped or defaulted; adjust `expected` only to match correct, non-lossy behaviour — do not weaken it to hide a real bug.)

- [ ] **Step 3: Commit**

```bash
git add scripts/roundtrip-test.ts src/shared/markover-codec
git commit -m "test(codec): cover malformed metadata degradation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE 5 — Track-changes integrity

## Task 12: Surface skipped (untracked) structural edits

**Context:** `track-changes-plugin.ts:228-230` wraps structural-deletion handling in a `try/catch` that, on error, lets the edit through **untracked with no feedback** — a tracked-changes document can silently contain invisible edits. Notify the user when this happens so they know a change was not recorded.

**Files:**
- Modify: `src/renderer/editor/extensions/track-changes-plugin.ts:228-230`
- Modify: `src/renderer/components/App.tsx` (listen for the event and toast)

- [ ] **Step 1: Emit an event on skip**

In `src/renderer/editor/extensions/track-changes-plugin.ts`, change the `catch` (lines 228-230) to:
```ts
                } catch {
                  // Structural change we can't track cleanly (e.g. node split).
                  // Let the edit through but warn — a tracked document must never
                  // contain silent, invisible edits.
                  if (typeof document !== 'undefined') {
                    document.dispatchEvent(new CustomEvent('markover:untracked-edit'));
                  }
                }
```

- [ ] **Step 2: Toast on the event (throttled)**

In `App.tsx`, add an effect (near the other `useEffect`s) that listens once and toasts at most every few seconds:
```tsx
useEffect(() => {
  let last = 0;
  const handler = () => {
    const now = performance.now();
    if (now - last < 4000) return;
    last = now;
    toast.info('A structural edit could not be tracked and was applied directly.');
  };
  document.addEventListener('markover:untracked-edit', handler);
  return () => document.removeEventListener('markover:untracked-edit', handler);
}, []);
```

- [ ] **Step 3: Manual verification**

Run `npm start`, enable Track Changes (`Ctrl+Shift+T`), then perform a deletion that crosses paragraph/list boundaries in a way the plugin can't track. Confirm the info toast appears (and does not spam on repeated edits).

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add src/renderer/editor/extensions/track-changes-plugin.ts src/renderer/components/App.tsx
git commit -m "feat(track-changes): warn when a structural edit cannot be tracked

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# PHASE 6 — GitHub integration Phase 1 (sign-in + Open/Save from GitHub)

> **Reviewer note:** This phase is the most speculative and design-heavy. Review these tasks more closely than the rest, and expect iteration. The deliberate design choice is **GitHub REST API over OAuth device flow** — no git binary, no clone, no working tree — because that eliminates the failure modes (merge state, credential helpers, detached heads) that make git unusable for non-developers. Real-time collaboration, PR-as-track-changes, and version history are explicitly **out of scope** for Phase 1 and belong in a later plan.

**One-time prerequisite (human):** Register a GitHub OAuth App for device flow: GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Enable **Device Flow**. Copy the **Client ID** (device flow needs no client secret). It will be placed in `src/main/github/auth.ts` as `GITHUB_CLIENT_ID`. Record it in the PR description; do not hardcode a secret.

## Task 13: GitHub token storage (encrypted at rest)

**Files:**
- Create: `src/main/github/token-store.ts`

- [ ] **Step 1: Implement encrypted token storage**

Create `src/main/github/token-store.ts`:
```ts
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';

const TOKEN_PATH = path.join(app.getPath('userData'), 'github-token.enc');

export async function saveToken(token: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is unavailable; cannot store GitHub token.');
  }
  const encrypted = safeStorage.encryptString(token);
  await fs.writeFile(TOKEN_PATH, encrypted);
}

export async function loadToken(): Promise<string | null> {
  try {
    const buf = await fs.readFile(TOKEN_PATH);
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(buf);
  } catch {
    return null;
  }
}

export async function clearToken(): Promise<void> {
  await fs.rm(TOKEN_PATH, { force: true });
}
```

- [ ] **Step 2: Lint and commit**

```bash
npm run lint
git add src/main/github/token-store.ts
git commit -m "feat(github): encrypted token storage via safeStorage

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 14: GitHub OAuth device flow (main process)

**Files:**
- Create: `src/main/github/auth.ts`

- [ ] **Step 1: Implement device flow**

Create `src/main/github/auth.ts`:
```ts
import { saveToken } from './token-store';

// Set to the Client ID of the registered GitHub OAuth App (device flow enabled).
export const GITHUB_CLIENT_ID = 'REPLACE_WITH_OAUTH_APP_CLIENT_ID';
const SCOPE = 'repo';

export interface DeviceCode {
  user_code: string;
  verification_uri: string;
  device_code: string;
  interval: number;
  expires_in: number;
}

export async function startDeviceFlow(): Promise<DeviceCode> {
  const res = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: GITHUB_CLIENT_ID, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`GitHub device code request failed (${res.status})`);
  return (await res.json()) as DeviceCode;
}

// Polls until the user authorises, then persists the token. Resolves with true on success.
export async function pollForToken(deviceCode: string, intervalSec: number, expiresInSec: number): Promise<boolean> {
  const deadline = Date.now() + expiresInSec * 1000;
  let interval = intervalSec;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });
    const data = (await res.json()) as { access_token?: string; error?: string; interval?: number };
    if (data.access_token) {
      await saveToken(data.access_token);
      return true;
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') { interval += 5; continue; }
    if (data.error === 'expired_token' || data.error === 'access_denied') return false;
  }
  return false;
}
```

- [ ] **Step 2: Lint and commit**

```bash
npm run lint
git add src/main/github/auth.ts
git commit -m "feat(github): OAuth device-flow authentication

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 15: GitHub REST API client (main process)

**Files:**
- Create: `src/main/github/api.ts`

- [ ] **Step 1: Implement the minimal client**

Create `src/main/github/api.ts`:
```ts
import { loadToken } from './token-store';

const BASE = 'https://api.github.com';

async function gh(pathAndQuery: string, init: RequestInit = {}): Promise<Response> {
  const token = await loadToken();
  if (!token) throw new Error('Not signed in to GitHub');
  return fetch(`${BASE}${pathAndQuery}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
}

export interface Repo { full_name: string; default_branch: string; }
export interface ContentEntry { name: string; path: string; type: 'file' | 'dir'; }

export async function getUser(): Promise<{ login: string } | null> {
  const res = await gh('/user');
  return res.ok ? ((await res.json()) as { login: string }) : null;
}

export async function listRepos(): Promise<Repo[]> {
  const res = await gh('/user/repos?per_page=100&sort=updated');
  if (!res.ok) throw new Error(`List repos failed (${res.status})`);
  return (await res.json()) as Repo[];
}

export async function listContents(owner: string, repo: string, dirPath = '', ref?: string): Promise<ContentEntry[]> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await gh(`/repos/${owner}/${repo}/contents/${encodeURIComponent(dirPath)}${q}`);
  if (!res.ok) throw new Error(`List contents failed (${res.status})`);
  return (await res.json()) as ContentEntry[];
}

export interface FileContent { content: string; sha: string; }

export async function getFile(owner: string, repo: string, filePath: string, ref?: string): Promise<FileContent> {
  const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const res = await gh(`/repos/${owner}/${repo}/contents/${filePath}${q}`);
  if (!res.ok) throw new Error(`Get file failed (${res.status})`);
  const data = (await res.json()) as { content: string; sha: string; encoding: string };
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

// Commit a file via the Contents API. `sha` must be the current blob sha when updating.
export async function putFile(
  owner: string, repo: string, filePath: string,
  content: string, message: string, branch: string, sha?: string,
): Promise<{ sha: string }> {
  const res = await gh(`/repos/${owner}/${repo}/contents/${filePath}`, {
    method: 'PUT',
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Commit failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}
```

- [ ] **Step 2: Lint and commit**

```bash
npm run lint
git add src/main/github/api.ts
git commit -m "feat(github): minimal REST client (repos, contents, get/put file)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 16: GitHub IPC channels + handlers

**Files:**
- Create: `src/main/github/ipc.ts`
- Modify: `src/shared/types/ipc.ts` (channel names + `ElectronAPI` methods)
- Modify: `src/main/preload.ts` (expose methods)
- Modify: `src/main/main.ts` (register handlers)

- [ ] **Step 1: Add channel names and API types**

In `src/shared/types/ipc.ts`, add to `IPC_CHANNELS`:
```ts
  GITHUB_START_AUTH: 'github:start-auth',
  GITHUB_POLL_AUTH: 'github:poll-auth',
  GITHUB_SIGN_OUT: 'github:sign-out',
  GITHUB_GET_USER: 'github:get-user',
  GITHUB_LIST_REPOS: 'github:list-repos',
  GITHUB_LIST_CONTENTS: 'github:list-contents',
  GITHUB_GET_FILE: 'github:get-file',
  GITHUB_PUT_FILE: 'github:put-file',
```
Add to the `ElectronAPI` interface:
```ts
  githubStartAuth: () => Promise<{ user_code: string; verification_uri: string; device_code: string; interval: number; expires_in: number }>;
  githubPollAuth: (deviceCode: string, interval: number, expiresIn: number) => Promise<boolean>;
  githubSignOut: () => Promise<void>;
  githubGetUser: () => Promise<{ login: string } | null>;
  githubListRepos: () => Promise<Array<{ full_name: string; default_branch: string }>>;
  githubListContents: (owner: string, repo: string, dirPath: string, ref?: string) => Promise<Array<{ name: string; path: string; type: 'file' | 'dir' }>>;
  githubGetFile: (owner: string, repo: string, filePath: string, ref?: string) => Promise<{ content: string; sha: string }>;
  githubPutFile: (owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) => Promise<{ sha: string }>;
```

- [ ] **Step 2: Implement handler registration**

Create `src/main/github/ipc.ts`:
```ts
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/types/ipc';
import { startDeviceFlow, pollForToken } from './auth';
import { clearToken } from './token-store';
import * as api from './api';

export function registerGitHubHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.GITHUB_START_AUTH, () => startDeviceFlow());
  ipcMain.handle(IPC_CHANNELS.GITHUB_POLL_AUTH, (_e, deviceCode: string, interval: number, expiresIn: number) =>
    pollForToken(deviceCode, interval, expiresIn));
  ipcMain.handle(IPC_CHANNELS.GITHUB_SIGN_OUT, () => clearToken());
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_USER, () => api.getUser());
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_REPOS, () => api.listRepos());
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_CONTENTS, (_e, owner: string, repo: string, dirPath: string, ref?: string) =>
    api.listContents(owner, repo, dirPath, ref));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_FILE, (_e, owner: string, repo: string, filePath: string, ref?: string) =>
    api.getFile(owner, repo, filePath, ref));
  ipcMain.handle(IPC_CHANNELS.GITHUB_PUT_FILE, (_e, owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) =>
    api.putFile(owner, repo, filePath, content, message, branch, sha));
}
```

- [ ] **Step 3: Expose in preload**

In `src/main/preload.ts`, add to the `api` object:
```ts
  githubStartAuth: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_START_AUTH),
  githubPollAuth: (deviceCode: string, interval: number, expiresIn: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_POLL_AUTH, deviceCode, interval, expiresIn),
  githubSignOut: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_SIGN_OUT),
  githubGetUser: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_USER),
  githubListRepos: () => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_REPOS),
  githubListContents: (owner: string, repo: string, dirPath: string, ref?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_CONTENTS, owner, repo, dirPath, ref),
  githubGetFile: (owner: string, repo: string, filePath: string, ref?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_FILE, owner, repo, filePath, ref),
  githubPutFile: (owner: string, repo: string, filePath: string, content: string, message: string, branch: string, sha?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.GITHUB_PUT_FILE, owner, repo, filePath, content, message, branch, sha),
```

- [ ] **Step 4: Register handlers at startup**

In `src/main/main.ts`, add the import near the other local imports (after line 28):
```ts
import { registerGitHubHandlers } from './github/ipc';
```
Call it once at the top level (after the IPC handlers are defined, e.g. just before `app.on('ready', …)`):
```ts
registerGitHubHandlers();
```

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/main/github/ipc.ts src/shared/types/ipc.ts src/main/preload.ts src/main/main.ts
git commit -m "feat(github): IPC wiring for auth and file operations

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 17: Renderer GitHub store + sign-in dialog

**Files:**
- Create: `src/renderer/github/github-store.ts`
- Create: `src/renderer/github/GitHubSignInDialog.tsx`

- [ ] **Step 1: Create the store**

Create `src/renderer/github/github-store.ts`:
```ts
import { create } from 'zustand';

// Identifies the GitHub file currently being edited, so Save knows where to commit.
export interface GitHubSource {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  sha: string;
}

interface GitHubState {
  login: string | null;
  source: GitHubSource | null;
  setLogin: (login: string | null) => void;
  setSource: (source: GitHubSource | null) => void;
}

export const useGitHubStore = create<GitHubState>((set) => ({
  login: null,
  source: null,
  setLogin: (login) => set({ login }),
  setSource: (source) => set({ source }),
}));
```

- [ ] **Step 2: Create the sign-in dialog**

Create `src/renderer/github/GitHubSignInDialog.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { useGitHubStore } from './github-store';
import { toast } from '../ui/toast/toast-store';

export function GitHubSignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setLogin = useGitHubStore((s) => s.setLogin);
  const [code, setCode] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setCode(null); setUri(null); setBusy(false); }
  }, [open]);

  const begin = async () => {
    setBusy(true);
    try {
      const dc = await window.electronAPI.githubStartAuth();
      setCode(dc.user_code);
      setUri(dc.verification_uri);
      await window.electronAPI.openPath(dc.verification_uri); // opens in default browser (https branch of shell handler)
      const ok = await window.electronAPI.githubPollAuth(dc.device_code, dc.interval, dc.expires_in);
      if (ok) {
        const user = await window.electronAPI.githubGetUser();
        setLogin(user?.login ?? null);
        toast.success(`Signed in to GitHub as ${user?.login ?? 'user'}`);
        onClose();
      } else {
        toast.error('GitHub sign-in was not completed.');
      }
    } catch (err) {
      toast.error(`GitHub sign-in failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[28rem] max-w-[90vw]">
        <h2 className="text-lg font-semibold mb-3">Sign in to GitHub</h2>
        {!code ? (
          <>
            <p className="text-sm mb-4">Markover will open github.com in your browser and give you a one-time code to authorise access.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded">Cancel</button>
              <button type="button" disabled={busy} onClick={begin} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded disabled:opacity-50">
                {busy ? 'Starting…' : 'Sign in'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm mb-2">Enter this code at <span className="font-mono">{uri}</span>:</p>
            <p className="text-2xl font-mono tracking-widest text-center my-4">{code}</p>
            <p className="text-xs text-gray-500">Waiting for authorisation… you can close this once approved.</p>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint and commit**

```bash
npm run lint
git add src/renderer/github/github-store.ts src/renderer/github/GitHubSignInDialog.tsx
git commit -m "feat(github): renderer store and device-flow sign-in dialog

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 18: Open-from-GitHub dialog + load into editor

**Files:**
- Create: `src/renderer/github/OpenFromGitHubDialog.tsx`
- Modify: `src/renderer/components/App.tsx` (open the dialog; load selected file content via the existing `loadContent` + set `GitHubSource`)

- [ ] **Step 1: Create the picker dialog**

Create `src/renderer/github/OpenFromGitHubDialog.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { useGitHubStore, type GitHubSource } from './github-store';
import { toast } from '../ui/toast/toast-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onOpened: (source: GitHubSource, content: string, fileName: string) => void;
}

export function OpenFromGitHubDialog({ open, onClose, onOpened }: Props) {
  const setSource = useGitHubStore((s) => s.setSource);
  const [repos, setRepos] = useState<Array<{ full_name: string; default_branch: string }>>([]);
  const [repo, setRepo] = useState<{ full_name: string; default_branch: string } | null>(null);
  const [dir, setDir] = useState('');
  const [entries, setEntries] = useState<Array<{ name: string; path: string; type: 'file' | 'dir' }>>([]);

  useEffect(() => {
    if (!open) return;
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListContents(owner, name, dir, repo.default_branch)
      .then((e) => setEntries(e.filter((x) => x.type === 'dir' || /\.(md|markdown)$/i.test(x.name))))
      .catch((e) => toast.error(`Could not list folder: ${e.message}`));
  }, [repo, dir]);

  const openFile = async (filePath: string, fileName: string) => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    try {
      const { content, sha } = await window.electronAPI.githubGetFile(owner, name, filePath, repo.default_branch);
      const source: GitHubSource = { owner, repo: name, branch: repo.default_branch, path: filePath, sha };
      setSource(source);
      onOpened(source, content, fileName);
      onClose();
    } catch (e) {
      toast.error(`Could not open file: ${(e as Error).message}`);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[80vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Open from GitHub</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">
            {repos.map((r) => (
              <li key={r.full_name}>
                <button type="button" onClick={() => { setRepo(r); setDir(''); }} className="w-full text-left py-2 hover:bg-gray-100 dark:hover:bg-gray-700 px-2">
                  {r.full_name}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="text-sm mb-2">
              <button type="button" onClick={() => { setRepo(null); setEntries([]); }} className="text-blue-600">← repos</button>
              {dir && <> / <button type="button" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))} className="text-blue-600">up</button></>}
              <span className="ml-2 font-mono">{repo.full_name}/{dir}</span>
            </div>
            <ul className="divide-y">
              {entries.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => e.type === 'dir' ? setDir(e.path) : openFile(e.path, e.name)}
                    className="w-full text-left py-2 hover:bg-gray-100 dark:hover:bg-gray-700 px-2"
                  >
                    {e.type === 'dir' ? '📁 ' : '📄 '}{e.name}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into App**

In `src/renderer/components/App.tsx`:
- Import both dialogs and the store near the other imports.
- Add state: `const [githubSignInOpen, setGithubSignInOpen] = useState(false);` and `const [githubOpenOpen, setGithubOpenOpen] = useState(false);`
- Add a handler that loads a GitHub file using the existing load path (mirror `onFileChanged`'s `doLoad`): set raw mode off, call `loadContent(content)`, set the title to the file name with no local path, and clear the local `filePath` (since this document lives on GitHub, not disk). Use the existing `guardDirty` before opening so unsaved local changes are protected.
- Render `<GitHubSignInDialog open={githubSignInOpen} onClose={() => setGithubSignInOpen(false)} />` and `<OpenFromGitHubDialog open={githubOpenOpen} onClose={() => setGithubOpenOpen(false)} onOpened={(src, content, fileName) => { setRawMode(false); rawContentRef.current=''; loadContent(content); setFile(null, fileName); setDirty(false); }} />` near the other dialogs.

- [ ] **Step 3: Add menu entries**

In `src/main/menu.ts`, under the File menu, add items that send menu actions `github-sign-in` and `github-open`. In `App.tsx`'s `onMenuAction` switch, add:
```tsx
        case 'github-sign-in': setGithubSignInOpen(true); break;
        case 'github-open': setGithubOpenOpen(true); break;
```

- [ ] **Step 4: Manual verification**

Run `npm start`. File → Sign in to GitHub → complete device flow in browser → toast confirms sign-in. File → Open from GitHub → pick a repo → navigate to a `.md` → it loads into the editor.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint
git add src/renderer/github/OpenFromGitHubDialog.tsx src/renderer/components/App.tsx src/main/menu.ts
git commit -m "feat(github): Open from GitHub picker and editor load

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Task 19: Save (commit) back to GitHub

**Files:**
- Modify: `src/renderer/components/App.tsx` (`handleSave` routes to GitHub when a `GitHubSource` is set)

- [ ] **Step 1: Route save to GitHub when the doc came from GitHub**

In `App.tsx`, read `const githubSource = useGitHubStore((s) => s.source);` and `const setGithubSource = useGitHubStore((s) => s.setSource);`. At the top of `handleSave`, before the local-file logic, add:
```tsx
    if (githubSource) {
      let content: string;
      if (isRawMode) content = rawContentRef.current;
      else { syncCommentsToMetadata(); content = getMarkdown(); }
      try {
        const { sha } = await window.electronAPI.githubPutFile(
          githubSource.owner, githubSource.repo, githubSource.path,
          content, `Edited ${githubSource.path} in Markover`, githubSource.branch, githubSource.sha,
        );
        setGithubSource({ ...githubSource, sha }); // keep sha current for the next commit
        setDirty(false);
        toast.success('Saved to GitHub');
      } catch (e) {
        toast.error(`GitHub save failed: ${(e as Error).message}`);
      }
      return;
    }
```
Add `githubSource`, `setGithubSource` to the `handleSave` `useCallback` dependency array.

- [ ] **Step 2: Clear the GitHub source on New / local Open**

Wherever a new/local document is loaded (`doNew`, and the local `onFileChanged` path), call `setGithubSource(null)` so a subsequent save goes to disk, not the previously-open GitHub file.

- [ ] **Step 3: Manual verification**

Open a `.md` from GitHub (Task 18), edit it, `Ctrl+S` → "Saved to GitHub" toast. Verify on github.com that a new commit appeared on the branch with the edited content. Save again (confirms the refreshed `sha` prevents a 409 conflict). Then File → New and save → confirm it prompts for a *local* path (GitHub source cleared).

- [ ] **Step 4: Lint and commit**

```bash
npm run lint
git add src/renderer/components/App.tsx
git commit -m "feat(github): commit edits back to GitHub on save

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification (run after all phases)

- [ ] **Headless suite green:** `npx tsx scripts/roundtrip-test.ts` → `0 failed`.
- [ ] **Lint clean:** `npm run lint` → no errors.
- [ ] **E2E suite:** `npm test` → passes (first run rebuilds the test package; allow time).
- [ ] **No leftover temp files** after repeated saves.
- [ ] **`npm audit`** shows the issue #16 Mermaid advisories resolved.
- [ ] **Issue #22 sample** renders correctly (bold task headings with nested bullets) in `npm start`.

---

## Out of scope for this plan (need their own brainstorming + plan)

These were discussed but are deliberately deferred — they are design-heavy and not safe for blind execution:

- **Autosave / crash recovery / session restore** — periodic snapshots to a recovery dir, "restore unsaved work?" on next launch. The atomic-save (Task 6) and external-change detection (Task 8) close the worst data-loss modes; full autosave is the next layer and deserves a focused plan.
- **GitHub Phase 2 — Suggest-changes-as-PR** — branch-per-suggestion, track-changes ↔ PR review-comment mapping, "Accept all" = merge. This is the killer feature but needs its own design pass.
- **GitHub Phase 3 — Version history & conflict-as-track-changes** — commit history panel, restore-as-new-commit, presenting remote changes as track changes to resolve.
- **Single-instance / multi-window architecture** — currently each `.md` link spawns an independent process; consolidating to one process with multiple windows is a larger refactor.
- **Larger UX** — welcome screen, document outline panel, settings dialog, `.docx` export, paste-from-Word cleanup.
- **CI + release automation** — `.github/workflows` for lint + roundtrip on PRs and tag-triggered releases; deriving the version into `forge.config.ts` at build time to remove the manual 4-location bump.
```
