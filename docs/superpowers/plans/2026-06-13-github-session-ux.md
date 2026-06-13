# GitHub Session UX, Save-to-GitHub & Minimal PR Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface GitHub sign-in state in the window title and menu, let a local document be published to GitHub (with branch selection and graceful handling of protected branches), and add a minimal read-only pull-request review mode.

**Architecture:** Builds on GitHub Phase 1 (PR #23). A single renderer→main `SESSION_STATE` IPC makes the renderer the source of truth for the window title and feeds the menu's sign-in/out toggle. Save-to-GitHub and PR-review reuse the existing `OpenFromGitHubDialog` browsing pattern and the existing `data-markov` track-change markers (so a PR diff renders through the unchanged parser). Pure functions (`composeTitle`, branch decision, `toTrackedMarkdown`) are unit-tested headlessly; GUI flows have manual checklists.

**Tech Stack:** Electron 41, React 19, TipTap 3, Zustand, Tailwind 4, markdown-it. GitHub via REST + the existing `safeStorage` token. Spec: `docs/superpowers/specs/2026-06-13-github-session-ux-design.md`.

## Environment (this machine)

- **Bash tool is broken** — use the **PowerShell tool** for all commands.
- **git is broken on PATH** — prefix every git command:
  `$env:PATH = "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.12\resources\app\git\cmd;$env:PATH"; git <args>`
- Tests: `npx tsx scripts/roundtrip-test.ts` (headless, ~3s). Lint: `npm run lint` (0 errors required; ~32 pre-existing warnings OK). Build gate: `npm run package`. `npx tsc --noEmit` has ~9 pre-existing renderer errors — add none.
- Multi-line commit messages: PowerShell single-quoted here-string (`@'…'@`, closing `'@` at column 0).
- Co-author every commit: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Work on branch `bulletproofing-and-github-phase-1` (already checked out). Do not launch the Electron app in subagents; the controller runs manual GUI checks.

## File Structure

**Phase A — session state (title + menu toggle)**
- Create: `src/renderer/github/compose-title.ts` (pure title string), `scripts/test-github-units.ts` (headless unit tests for pure helpers)
- Modify: `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/main/main.ts`, `src/main/menu.ts`, `src/renderer/components/App.tsx`

**Phase B — save local → GitHub**
- Create: `src/renderer/github/branch-plan.ts` (pure: new-vs-existing branch decision), `src/renderer/github/SaveToGitHubDialog.tsx`, `src/renderer/github/github-write-fallback.ts` (shared graceful-rejection handler)
- Modify: `src/main/github/api.ts`, `src/main/github/ipc.ts`, `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/main/menu.ts`, `src/renderer/components/App.tsx`

**Phase C — minimal PR review**
- Create: `src/renderer/github/pr-diff.ts` (pure: base+head → tracked markdown), `src/renderer/github/ReviewPullRequestDialog.tsx`, `src/renderer/github/ReviewBanner.tsx`
- Modify: `src/main/github/api.ts`, `src/main/github/ipc.ts`, `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/main/menu.ts`, `src/renderer/github/github-store.ts`, `src/renderer/components/App.tsx`, `scripts/roundtrip-test.ts`

---

# PHASE A — Session state: title indicator + sign-in/out toggle

## Task 1: `composeTitle` pure helper + headless test

**Files:**
- Create: `src/renderer/github/compose-title.ts`
- Create: `scripts/test-github-units.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-github-units.ts`:
```ts
import { composeTitle } from '../src/renderer/github/compose-title';

let pass = 0, fail = 0;
function eq(name: string, got: string, want: string) {
  if (got === want) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}\n    got:  ${JSON.stringify(got)}\n    want: ${JSON.stringify(want)}`); }
}

eq('signed out', composeTitle('notes.md', null), 'notes.md — Markover');
eq('signed in', composeTitle('notes.md', 'alice'), 'notes.md — Markover · GitHub: alice');
eq('untitled signed in', composeTitle('Untitled', 'alice'), 'Untitled — Markover · GitHub: alice');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
```

- [ ] **Step 2: Run it to confirm failure**

Run: `npx tsx scripts/test-github-units.ts`
Expected: fails to import (`composeTitle` not found).

- [ ] **Step 3: Implement**

Create `src/renderer/github/compose-title.ts`:
```ts
/**
 * The window title string. Renderer-side single source of truth; sent to main
 * via SESSION_STATE, which calls mainWindow.setTitle with this value.
 */
export function composeTitle(documentName: string, githubLogin: string | null): string {
  const base = `${documentName} — Markover`;
  return githubLogin ? `${base} · GitHub: ${githubLogin}` : base;
}
```

- [ ] **Step 4: Run it to confirm pass**

Run: `npx tsx scripts/test-github-units.ts`
Expected: `3 passed, 0 failed`.

- [ ] **Step 5: Commit**

```
feat(github): composeTitle helper for the window title
```

## Task 2: `SESSION_STATE` IPC — channel, types, preload, main handler

**Files:**
- Modify: `src/shared/types/ipc.ts`, `src/main/preload.ts`, `src/main/main.ts`

- [ ] **Step 1: Add the channel + API type** in `src/shared/types/ipc.ts`

Add to `IPC_CHANNELS` (before `} as const;`):
```ts
  SESSION_STATE: 'session:state',
```
Add to the `ElectronAPI` interface:
```ts
  notifySessionState: (documentName: string, githubLogin: string | null) => void;
```

- [ ] **Step 2: Expose in preload** — `src/main/preload.ts`, add to the `api` object:
```ts
  notifySessionState: (documentName: string, githubLogin: string | null) =>
    ipcRenderer.send(IPC_CHANNELS.SESSION_STATE, documentName, githubLogin),
```

- [ ] **Step 3: Handle in main** — `src/main/main.ts`

Add a module-level variable near `let currentFilePath` (~line 55):
```ts
let sessionDocumentName = 'Untitled';
let githubLogin: string | null = null;
```
Add a title composer near `updateTitle` (~line 114) and a handler. First, replace the body of `updateTitle()` so it composes from session state instead of `currentFilePath`:
```ts
function updateTitle() {
  if (!mainWindow) return;
  const base = `${sessionDocumentName} — Markover`;
  mainWindow.setTitle(githubLogin ? `${base} · GitHub: ${githubLogin}` : base);
}
```
Register the IPC handler near the other `ipcMain` calls (e.g. after the spellcheck handlers):
```ts
ipcMain.on(IPC_CHANNELS.SESSION_STATE, (_event, documentName: string, login: string | null) => {
  const loginChanged = githubLogin !== login;
  sessionDocumentName = documentName || 'Untitled';
  githubLogin = login;
  updateTitle();
  if (loginChanged) rebuildMenu();
});
```

NOTE: existing calls to `updateTitle()` in `openFileByPath`, `FILE_OPEN`, `FILE_SAVE`, `FILE_SAVE_AS` still work — they now set the title from whatever session state the renderer last sent. The renderer will send `SESSION_STATE` on every document change (Task 3), so the displayed name stays correct. The previous `path.basename(currentFilePath)` title logic is intentionally removed.

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit 2>&1 | Select-String 'ipc.ts|preload.ts|main.ts'` → no new errors. `npm run lint` → 0 errors.

- [ ] **Step 5: Commit**

```
feat(github): SESSION_STATE channel; main composes window title from renderer state
```

## Task 3: Renderer pushes session state on document/login change

**Files:**
- Modify: `src/renderer/components/App.tsx`

- [ ] **Step 1: Add the effect**

In `src/renderer/components/App.tsx`, the editor store exposes `fileName` (see `src/renderer/store/editor-store.ts`). Read it and the GitHub login, and push on change. Add `fileName` to the `useEditorStore` destructure if not already present:
```tsx
  const { filePath, isDirty, setFile, setDirty, isRawMode, setRawMode, fileName } = useEditorStore();
```
Add `login` to the GitHub store reads (near the existing `githubSource`):
```tsx
  const githubLogin = useGitHubStore((s) => s.login);
```
Add an effect near the other top-level effects:
```tsx
  // Keep the window title + native menu in sync with the open document and
  // GitHub sign-in state (main composes the title and toggles the menu).
  useEffect(() => {
    window.electronAPI.notifySessionState(fileName || 'Untitled', githubLogin);
  }, [fileName, githubLogin]);
```

- [ ] **Step 2: Verify**

Run: `npm run lint` → 0 errors. `npx tsc --noEmit 2>&1 | Select-String 'App.tsx'` → only the 2 pre-existing trackChangesPlugin errors.

- [ ] **Step 3: Commit**

```
feat(github): renderer notifies session state for title + menu
```

## Task 4: Sign-in/out menu toggle + sign-out handler

**Files:**
- Modify: `src/main/menu.ts`, `src/main/main.ts`, `src/renderer/components/App.tsx`

- [ ] **Step 1: Menu toggle** — `src/main/menu.ts`

Change the signature:
```ts
export function buildMenu(
  window: BrowserWindow,
  recentFiles: string[],
  openFile: (filePath: string) => Promise<void>,
  githubLogin: string | null,
): Menu {
```
In the File submenu, replace the current single "Sign in to GitHub..." item (added in Phase 1) with a toggle, and keep "Open from GitHub...". Locate the GitHub menu block and make it:
```ts
        { type: 'separator' },
        githubLogin
          ? { label: `Sign out of GitHub (${githubLogin})`, click: () => sendAction('github-sign-out') }
          : { label: 'Sign in to GitHub...', click: () => sendAction('github-sign-in') },
        { label: 'Open from GitHub...', click: () => sendAction('github-open') },
```

- [ ] **Step 2: Pass login from main** — `src/main/main.ts`

Update `rebuildMenu()`:
```ts
function rebuildMenu() {
  if (!mainWindow) return;
  Menu.setApplicationMenu(buildMenu(mainWindow, recentFiles, openFileByPath, githubLogin));
}
```

- [ ] **Step 3: Sign-out handler** — `src/renderer/components/App.tsx`

In the `onMenuAction` switch, add:
```tsx
        case 'github-sign-out': {
          const proceed = !isDirty || window.confirm('You have unsaved changes. Sign out of GitHub anyway?');
          if (proceed) {
            await window.electronAPI.githubSignOut();
            useGitHubStore.getState().setLogin(null);
            setGithubSource(null);
            toast.info('Signed out of GitHub.');
          }
          break;
        }
```
Add `setGithubSource` (and `isDirty`) to that effect's dependency array if not present.

- [ ] **Step 4: Verify build**

Run: `npm run lint` → 0 errors. `npx tsc --noEmit 2>&1 | Select-String 'menu.ts|main.ts|App.tsx'` → no new errors.

- [ ] **Step 5: Commit**

```
feat(github): sign-in/out menu toggle and sign-out (detach to local)
```

- [ ] **Step 6: Phase A manual check (controller)**

`npm start`: sign in → title shows `· GitHub: <user>` and File menu shows "Sign out of GitHub (<user>)". Open from GitHub → title shows the filename. Sign out with a clean doc → title drops the suffix, menu reverts to "Sign in".

---

# PHASE B — Save local/new file to GitHub

## Task 5: Branch API + branch-decision helper

**Files:**
- Modify: `src/main/github/api.ts`, `src/main/github/ipc.ts`, `src/shared/types/ipc.ts`, `src/main/preload.ts`
- Create: `src/renderer/github/branch-plan.ts`
- Modify: `scripts/test-github-units.ts`

- [ ] **Step 1: Add branch fns to the client** — `src/main/github/api.ts`
```ts
export interface Branch { name: string; protected: boolean; }

export async function listBranches(owner: string, repo: string): Promise<Branch[]> {
  const res = await gh(`/repos/${owner}/${repo}/branches?per_page=100`);
  if (!res.ok) throw new Error(`List branches failed (${res.status})`);
  return (await res.json()) as Branch[];
}

export async function getBranchHeadSha(owner: string, repo: string, branch: string): Promise<string> {
  const res = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (!res.ok) throw new Error(`Get branch head failed (${res.status})`);
  const data = (await res.json()) as { object: { sha: string } };
  return data.object.sha;
}

export async function createBranch(owner: string, repo: string, newBranch: string, fromSha: string): Promise<void> {
  const res = await gh(`/repos/${owner}/${repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Create branch failed (${res.status}): ${body}`);
  }
}
```

- [ ] **Step 2: Wire IPC + preload + types**

`src/shared/types/ipc.ts` — add channels:
```ts
  GITHUB_LIST_BRANCHES: 'github:list-branches',
  GITHUB_GET_BRANCH_SHA: 'github:get-branch-sha',
  GITHUB_CREATE_BRANCH: 'github:create-branch',
```
Add `ElectronAPI` methods:
```ts
  githubListBranches: (owner: string, repo: string) => Promise<Array<{ name: string; protected: boolean }>>;
  githubGetBranchSha: (owner: string, repo: string, branch: string) => Promise<string>;
  githubCreateBranch: (owner: string, repo: string, newBranch: string, fromSha: string) => Promise<void>;
```
`src/main/github/ipc.ts` — add handlers inside `registerGitHubHandlers`:
```ts
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_BRANCHES, (_e, owner: string, repo: string) => api.listBranches(owner, repo));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_BRANCH_SHA, (_e, owner: string, repo: string, branch: string) => api.getBranchHeadSha(owner, repo, branch));
  ipcMain.handle(IPC_CHANNELS.GITHUB_CREATE_BRANCH, (_e, owner: string, repo: string, newBranch: string, fromSha: string) => api.createBranch(owner, repo, newBranch, fromSha));
```
`src/main/preload.ts` — add:
```ts
  githubListBranches: (owner: string, repo: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_BRANCHES, owner, repo),
  githubGetBranchSha: (owner: string, repo: string, branch: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_BRANCH_SHA, owner, repo, branch),
  githubCreateBranch: (owner: string, repo: string, newBranch: string, fromSha: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_CREATE_BRANCH, owner, repo, newBranch, fromSha),
```

- [ ] **Step 3: Write the failing test for the branch-decision helper** — append to `scripts/test-github-units.ts`:
```ts
import { defaultNewBranchName } from '../src/renderer/github/branch-plan';
eq('default branch name', defaultNewBranchName('notes.md'), 'markover/notes.md');
eq('default branch name strips dir', defaultNewBranchName('docs/notes.md'), 'markover/notes.md');
```

- [ ] **Step 4: Run to confirm failure**

Run: `npx tsx scripts/test-github-units.ts` → fails importing `branch-plan`.

- [ ] **Step 5: Implement** — `src/renderer/github/branch-plan.ts`:
```ts
// A branch choice in the Save-to-GitHub dialog: an existing branch, or a new one.
export type BranchChoice =
  | { kind: 'existing'; name: string }
  | { kind: 'new'; name: string };

/** Default name for a freshly-created branch, derived from the file name. */
export function defaultNewBranchName(fileName: string): string {
  const base = fileName.split('/').pop() || fileName;
  return `markover/${base}`;
}
```

- [ ] **Step 6: Run to confirm pass**

Run: `npx tsx scripts/test-github-units.ts` → all pass.

- [ ] **Step 7: Verify build + commit**

`npm run lint` → 0 errors; `npx tsc --noEmit 2>&1 | Select-String 'api.ts|ipc.ts|preload.ts'` → none.
```
feat(github): branch API (list/head-sha/create) + branch-plan helper
```

## Task 6: Shared graceful-write fallback

**Files:**
- Create: `src/renderer/github/github-write-fallback.ts`

- [ ] **Step 1: Implement**

Create `src/renderer/github/github-write-fallback.ts`:
```ts
import { toast } from '../ui/toast/toast-store';

// True for GitHub write rejections caused by protection / permissions / SSO,
// where the right move is to offer another branch or a local save (not a raw error).
export function isProtectedOrForbidden(err: unknown): boolean {
  const m = (err as Error)?.message ?? '';
  return /\((403|404|409|422)\)/.test(m) || /protected|not\s*found|pull request/i.test(m);
}

export interface FallbackChoice { action: 'choose-branch' | 'save-local' | 'cancel'; }

// Shows a clear, actionable dialog for a rejected write and returns the user's choice.
export function offerWriteFallback(repoLabel: string, branch: string): FallbackChoice {
  const msg =
    `${repoLabel} blocked a direct change to "${branch}".\n\n` +
    `OK = choose another branch (or create one)\n` +
    `Cancel = save a copy to your computer instead.`;
  const chooseBranch = window.confirm(msg);
  if (chooseBranch) return { action: 'choose-branch' };
  return { action: 'save-local' };
}

export function notifyWriteFailed(err: unknown): void {
  toast.error(`GitHub save failed: ${(err as Error)?.message ?? 'unknown error'}`);
}
```

NOTE: `window.confirm` is already used elsewhere in App.tsx (sign-out, conflict), so it is the established modal primitive here. A 3-way custom dialog is a later refinement; two-way (choose-branch vs save-local) covers the spec's intent.

- [ ] **Step 2: Verify + commit**

`npm run lint` → 0 errors.
```
feat(github): shared graceful fallback for rejected writes
```

## Task 7: SaveToGitHubDialog + menu entry + wiring

**Files:**
- Create: `src/renderer/github/SaveToGitHubDialog.tsx`
- Modify: `src/main/menu.ts`, `src/renderer/components/App.tsx`

- [ ] **Step 1: Create the dialog**

Create `src/renderer/github/SaveToGitHubDialog.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { useGitHubStore, type GitHubSource } from './github-store';
import { defaultNewBranchName } from './branch-plan';
import { toast } from '../ui/toast/toast-store';

interface Props {
  open: boolean;
  onClose: () => void;
  initialFileName: string;
  getContent: () => string;
  onSaved: (source: GitHubSource, fileName: string) => void;
}

type Repo = { full_name: string; default_branch: string };
type Entry = { name: string; path: string; type: 'file' | 'dir' };
type Branch = { name: string; protected: boolean };

export function SaveToGitHubDialog({ open, onClose, initialFileName, getContent, onSaved }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [dir, setDir] = useState('');
  const [dirs, setDirs] = useState<Entry[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [fileName, setFileName] = useState(initialFileName);
  const [branchMode, setBranchMode] = useState<'existing' | 'new'>('existing');
  const [existingBranch, setExistingBranch] = useState('');
  const [newBranch, setNewBranch] = useState(defaultNewBranchName(initialFileName));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepo(null); setDir(''); setFileName(initialFileName);
    setNewBranch(defaultNewBranchName(initialFileName));
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open, initialFileName]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    setExistingBranch(repo.default_branch);
    setMessage(`Add ${fileName} via Markover`);
    window.electronAPI.githubListContents(owner, name, dir, repo.default_branch)
      .then((e) => setDirs(e.filter((x) => x.type === 'dir')))
      .catch((e) => toast.error(`Could not list folder: ${e.message}`));
    window.electronAPI.githubListBranches(owner, name).then(setBranches).catch(() => setBranches([]));
  }, [repo, dir]); // eslint-disable-line

  const commit = async () => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    const branch = branchMode === 'new' ? newBranch : existingBranch;
    const path = dir ? `${dir}/${fileName}` : fileName;
    setBusy(true);
    try {
      if (branchMode === 'new') {
        const baseSha = await window.electronAPI.githubGetBranchSha(owner, name, repo.default_branch);
        await window.electronAPI.githubCreateBranch(owner, name, branch, baseSha);
      }
      const { sha } = await window.electronAPI.githubPutFile(owner, name, path, getContent(), message || `Add ${fileName} via Markover`, branch);
      const source: GitHubSource = { owner, repo: name, branch, path, sha };
      useGitHubStore.getState().setSource(source);
      onSaved(source, fileName);
      toast.success(branch === repo.default_branch
        ? 'Saved to GitHub'
        : `Committed to ${branch} — open a pull request on GitHub to merge`);
      onClose();
    } catch (e) {
      toast.error(`Save to GitHub failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Save to GitHub</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">
            {repos.map((r) => (
              <li key={r.full_name}>
                <button type="button" onClick={() => setRepo(r)} className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700">{r.full_name}</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="space-y-3 text-sm">
            <div>
              <button type="button" onClick={() => { setRepo(null); setDir(''); }} className="text-blue-600">← repos</button>
              <span className="ml-2 font-mono">{repo.full_name}/{dir}</span>
            </div>
            <div>
              <div className="mb-1 text-gray-500">Folder</div>
              <ul className="divide-y border rounded max-h-32 overflow-auto">
                {dir && <li><button type="button" className="w-full text-left px-2 py-1 text-blue-600" onClick={() => setDir(dir.split('/').slice(0, -1).join('/'))}>↑ up</button></li>}
                {dirs.map((d) => (
                  <li key={d.path}><button type="button" className="w-full text-left px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setDir(d.path)}>📁 {d.name}</button></li>
                ))}
              </ul>
            </div>
            <label className="block">File name
              <input className="mt-1 w-full border rounded px-2 py-1 dark:bg-gray-900" value={fileName} onChange={(e) => setFileName(e.target.value)} />
            </label>
            <fieldset className="space-y-1">
              <legend className="text-gray-500">Branch</legend>
              <label className="flex items-center gap-2">
                <input type="radio" checked={branchMode === 'existing'} onChange={() => setBranchMode('existing')} />
                <select className="border rounded px-2 py-1 dark:bg-gray-900" value={existingBranch} onChange={(e) => setExistingBranch(e.target.value)} disabled={branchMode !== 'existing'}>
                  {branches.map((b) => <option key={b.name} value={b.name}>{b.name}{b.protected ? ' (protected)' : ''}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={branchMode === 'new'} onChange={() => setBranchMode('new')} />
                <span>New branch</span>
                <input className="border rounded px-2 py-1 dark:bg-gray-900 flex-1" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} disabled={branchMode !== 'new'} />
              </label>
            </fieldset>
            <label className="block">Commit message
              <input className="mt-1 w-full border rounded px-2 py-1 dark:bg-gray-900" value={message} onChange={(e) => setMessage(e.target.value)} />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="px-3 py-1.5 border rounded">Cancel</button>
              <button type="button" disabled={busy || !fileName} onClick={commit} className="px-3 py-1.5 bg-blue-600 text-white rounded disabled:opacity-50">{busy ? 'Saving…' : 'Commit'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Menu entry** — `src/main/menu.ts`, in the File submenu GitHub block (after "Open from GitHub..."):
```ts
        { label: 'Save to GitHub...', click: () => sendAction('github-save-as') },
```

- [ ] **Step 3: Wire into App** — `src/renderer/components/App.tsx`
  - Import: `import { SaveToGitHubDialog } from '../github/SaveToGitHubDialog';`
  - State: `const [githubSaveOpen, setGithubSaveOpen] = useState(false);`
  - Menu case (in `onMenuAction`): `case 'github-save-as': if (githubLogin) setGithubSaveOpen(true); else toast.info('Sign in to GitHub first.'); break;`
  - Render near the other dialogs:
```tsx
      <SaveToGitHubDialog
        open={githubSaveOpen}
        onClose={() => setGithubSaveOpen(false)}
        initialFileName={fileName && fileName !== 'Untitled' ? fileName : 'untitled.md'}
        getContent={() => { if (isRawMode) return rawContentRef.current; syncCommentsToMetadata(); return getMarkdown(); }}
        onSaved={(_src, name) => { setFile(null, name); setDirty(false); }}
      />
```
  (`setGithubSource` is already called inside the dialog via the store, so the doc is GitHub-backed; `onSaved` just updates the display name and clears dirty.)

- [ ] **Step 4: Verify build**

`npm run lint` → 0 errors; `npx tsc --noEmit 2>&1 | Select-String 'SaveToGitHubDialog|App.tsx|menu.ts'` → no new errors.

- [ ] **Step 5: Commit**

```
feat(github): Save to GitHub dialog (repo/folder/filename/branch/message)
```

## Task 8: Route rejected `Ctrl+S` on a GitHub-backed file through the fallback

**Files:**
- Modify: `src/renderer/components/App.tsx`

- [ ] **Step 1: Update the GitHub branch of `handleSave`**

The GitHub block in `handleSave` currently toasts a raw error on failure. Replace its `catch` so a protected/forbidden rejection offers the fallback:
```tsx
      } catch (e) {
        const { isProtectedOrForbidden, offerWriteFallback, notifyWriteFailed } = await import('../github/github-write-fallback');
        if (isProtectedOrForbidden(e)) {
          const choice = offerWriteFallback(`${githubSource.owner}/${githubSource.repo}`, githubSource.branch);
          if (choice.action === 'choose-branch') { setGithubSaveOpen(true); }
          else if (choice.action === 'save-local') { setGithubSource(null); await handleSaveAs(); }
        } else {
          notifyWriteFailed(e);
        }
      }
```
(`handleSaveAs` and `setGithubSaveOpen` are in scope. The dynamic `import()` keeps the helper out of the hot path; a static import at the top of App.tsx is equally fine — use whichever the linter prefers.)

- [ ] **Step 2: Verify build + manual check (controller)**

`npm run lint` → 0 errors. Manual: open/create a doc, Save to GitHub to a personal repo default branch → commit appears on GitHub. Save choosing a new branch → branch + commit appear, toast points to a PR. Attempt to save to a protected branch → the fallback prompt appears (choose-branch reopens the dialog; cancel → Save-As to disk), no raw error.

- [ ] **Step 3: Commit**

```
feat(github): protected-branch fallback on save to a GitHub-backed file
```

---

# PHASE C — Minimal PR review (read-only)

## Task 9: PR API + IPC

**Files:**
- Modify: `src/main/github/api.ts`, `src/main/github/ipc.ts`, `src/shared/types/ipc.ts`, `src/main/preload.ts`

- [ ] **Step 1: Add PR fns** — `src/main/github/api.ts`
```ts
export interface PullRequest { number: number; title: string; user: string; base: string; head: string; updated_at: string; }

export async function listPullRequests(owner: string, repo: string): Promise<PullRequest[]> {
  const res = await gh(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  if (!res.ok) throw new Error(`List pull requests failed (${res.status})`);
  const data = (await res.json()) as Array<{ number: number; title: string; user: { login: string }; base: { ref: string }; head: { ref: string }; updated_at: string }>;
  return data.map((p) => ({ number: p.number, title: p.title, user: p.user.login, base: p.base.ref, head: p.head.ref, updated_at: p.updated_at }));
}

export async function listPullRequestFiles(owner: string, repo: string, num: number): Promise<{ filename: string; status: string }[]> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}/files?per_page=100`);
  if (!res.ok) throw new Error(`List PR files failed (${res.status})`);
  return (await res.json()) as { filename: string; status: string }[];
}

export async function getPullRequest(owner: string, repo: string, num: number): Promise<{ baseSha: string; headSha: string; baseRef: string; headRef: string; author: string }> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}`);
  if (!res.ok) throw new Error(`Get PR failed (${res.status})`);
  const p = (await res.json()) as { base: { sha: string; ref: string }; head: { sha: string; ref: string }; user: { login: string } };
  return { baseSha: p.base.sha, headSha: p.head.sha, baseRef: p.base.ref, headRef: p.head.ref, author: p.user.login };
}

export async function submitReview(owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string): Promise<void> {
  const res = await gh(`/repos/${owner}/${repo}/pulls/${num}/reviews`, {
    method: 'POST',
    body: JSON.stringify({ event, body }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Submit review failed (${res.status}): ${txt}`);
  }
}
```

- [ ] **Step 2: Wire IPC + preload + types** (mirror the existing `github*` pattern)

`src/shared/types/ipc.ts` channels:
```ts
  GITHUB_LIST_PRS: 'github:list-prs',
  GITHUB_LIST_PR_FILES: 'github:list-pr-files',
  GITHUB_GET_PR: 'github:get-pr',
  GITHUB_SUBMIT_REVIEW: 'github:submit-review',
```
`ElectronAPI` methods:
```ts
  githubListPullRequests: (owner: string, repo: string) => Promise<Array<{ number: number; title: string; user: string; base: string; head: string; updated_at: string }>>;
  githubListPullRequestFiles: (owner: string, repo: string, num: number) => Promise<Array<{ filename: string; status: string }>>;
  githubGetPullRequest: (owner: string, repo: string, num: number) => Promise<{ baseSha: string; headSha: string; baseRef: string; headRef: string; author: string }>;
  githubSubmitReview: (owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => Promise<void>;
```
`src/main/github/ipc.ts` handlers:
```ts
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_PRS, (_e, owner: string, repo: string) => api.listPullRequests(owner, repo));
  ipcMain.handle(IPC_CHANNELS.GITHUB_LIST_PR_FILES, (_e, owner: string, repo: string, num: number) => api.listPullRequestFiles(owner, repo, num));
  ipcMain.handle(IPC_CHANNELS.GITHUB_GET_PR, (_e, owner: string, repo: string, num: number) => api.getPullRequest(owner, repo, num));
  ipcMain.handle(IPC_CHANNELS.GITHUB_SUBMIT_REVIEW, (_e, owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => api.submitReview(owner, repo, num, event, body));
```
`src/main/preload.ts`:
```ts
  githubListPullRequests: (owner: string, repo: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_PRS, owner, repo),
  githubListPullRequestFiles: (owner: string, repo: string, num: number) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_LIST_PR_FILES, owner, repo, num),
  githubGetPullRequest: (owner: string, repo: string, num: number) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_GET_PR, owner, repo, num),
  githubSubmitReview: (owner: string, repo: string, num: number, event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT', body: string) => ipcRenderer.invoke(IPC_CHANNELS.GITHUB_SUBMIT_REVIEW, owner, repo, num, event, body),
```

- [ ] **Step 3: Verify + commit**

`npm run lint` → 0 errors; tsc shows no new errors in these files.
```
feat(github): pull-request API (list/files/get/submit-review) + IPC
```

## Task 10: `toTrackedMarkdown` — line/block diff to tracked-changes markdown

**Files:**
- Create: `src/renderer/github/pr-diff.ts`
- Modify: `scripts/roundtrip-test.ts`

- [ ] **Step 1: Write failing cases** — in `scripts/roundtrip-test.ts`, add an assertion block before the final summary (mirroring the existing literal-quote block; `passed`/`failed`/`failures` are in scope). Import at top of file:
```ts
import { toTrackedMarkdown } from '../src/renderer/github/pr-diff';
```
Add:
```ts
{
  const base = 'Line one.\n\nLine two.\n';
  const head = 'Line one.\n\nLine two changed.\n';
  const out = toTrackedMarkdown(base, head, 'alice', '2026-01-01');
  const ok = out.includes('data-markov="del"') && out.includes('data-markov="ins"')
    && out.includes('Line one.') && !out.match(/Line one\.[^]*data-markov/);
  if (ok) { passed++; console.log('  PASS  pr-diff marks a changed block'); }
  else { failed++; failures.push({ name: 'pr-diff marks a changed block', input: head, expected: 'ins+del around changed block, line one untouched', got: out }); console.log('  FAIL  pr-diff marks a changed block'); }
}
{
  const same = 'No change.\n';
  const out = toTrackedMarkdown(same, same, 'alice', '2026-01-01');
  const ok = !out.includes('data-markov');
  if (ok) { passed++; console.log('  PASS  pr-diff: identical input has no marks'); }
  else { failed++; failures.push({ name: 'pr-diff identical', input: same, expected: 'no markers', got: out }); console.log('  FAIL  pr-diff: identical input has no marks'); }
}
```

- [ ] **Step 2: Run to confirm failure**

Run: `npx tsx scripts/roundtrip-test.ts` → the two new assertions FAIL (import missing).

- [ ] **Step 3: Implement** — `src/renderer/github/pr-diff.ts`:
```ts
// Line/block-level diff of two markdown strings → a markdown string with the
// existing markover ins/del span markers around changed blocks. The output flows
// through the unchanged parser (src/renderer/editor/markdown/parser.ts), which
// converts data-markov spans into track-change marks. Pure + deterministic.

function blocks(md: string): string[] {
  return md.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter((b) => b.length > 0);
}

// Longest-common-subsequence over blocks → a sequence of {type, text} ops.
type Op = { type: 'same' | 'del' | 'ins'; text: string };
function diffBlocks(a: string[], b: string[]): Op[] {
  const m = a.length, n = b.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { ops.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { ops.push({ type: 'del', text: a[i] }); i++; }
    else { ops.push({ type: 'ins', text: b[j] }); j++; }
  }
  while (i < m) { ops.push({ type: 'del', text: a[i] }); i++; }
  while (j < n) { ops.push({ type: 'ins', text: b[j] }); j++; }
  return ops;
}

function esc(s: string): string { return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }

export function toTrackedMarkdown(baseMd: string, headMd: string, author: string, date: string): string {
  const ops = diffBlocks(blocks(baseMd), blocks(headMd));
  const out: string[] = [];
  let counter = 0;
  for (const op of ops) {
    if (op.type === 'same') { out.push(op.text); continue; }
    const id = `pr${++counter}`;
    const kind = op.type === 'del' ? 'del' : 'ins';
    out.push(`<span data-markov="${kind}" data-change-id="${id}" data-author="${esc(author)}" data-date="${esc(date)}">${op.text}</span>`);
  }
  return out.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npx tsx scripts/roundtrip-test.ts` → both new assertions PASS; all prior tests still pass.

- [ ] **Step 5: Commit**

```
feat(github): toTrackedMarkdown — line/block PR diff to track-change markers
```

## Task 11: Review state + ReviewPullRequestDialog

**Files:**
- Modify: `src/renderer/github/github-store.ts`
- Create: `src/renderer/github/ReviewPullRequestDialog.tsx`

- [ ] **Step 1: Extend the store** — `src/renderer/github/github-store.ts`

Add to the `GitHubState` interface and store:
```ts
export interface ReviewSession {
  owner: string; repo: string; number: number; title: string; path: string;
}
```
In `GitHubState`:
```ts
  reviewSession: ReviewSession | null;
  reviewMode: boolean;
  setReviewSession: (s: ReviewSession | null) => void;
  setReviewMode: (on: boolean) => void;
```
In the `create(...)` body:
```ts
  reviewSession: null,
  reviewMode: false,
  setReviewSession: (reviewSession) => set({ reviewSession }),
  setReviewMode: (reviewMode) => set({ reviewMode }),
```

- [ ] **Step 2: Create the dialog** — `src/renderer/github/ReviewPullRequestDialog.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { toast } from '../ui/toast/toast-store';
import { toTrackedMarkdown } from './pr-diff';
import type { ReviewSession } from './github-store';

interface Props {
  open: boolean;
  onClose: () => void;
  onReview: (session: ReviewSession, trackedMarkdown: string) => void;
}
type Repo = { full_name: string; default_branch: string };
type PR = { number: number; title: string; user: string; base: string; head: string };

export function ReviewPullRequestDialog({ open, onClose, onReview }: Props) {
  const [repos, setRepos] = useState<Repo[]>([]);
  const [repo, setRepo] = useState<Repo | null>(null);
  const [prs, setPrs] = useState<PR[]>([]);
  const [pr, setPr] = useState<PR | null>(null);
  const [files, setFiles] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRepo(null); setPr(null); setFiles([]);
    window.electronAPI.githubListRepos().then(setRepos).catch((e) => toast.error(`Could not list repos: ${e.message}`));
  }, [open]);

  useEffect(() => {
    if (!repo) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListPullRequests(owner, name).then(setPrs).catch((e) => toast.error(`Could not list PRs: ${e.message}`));
  }, [repo]);

  useEffect(() => {
    if (!repo || !pr) return;
    const [owner, name] = repo.full_name.split('/');
    window.electronAPI.githubListPullRequestFiles(owner, name, pr.number)
      .then((fs) => setFiles(fs.filter((f) => /\.(md|markdown)$/i.test(f.filename)).map((f) => f.filename)))
      .catch((e) => toast.error(`Could not list PR files: ${e.message}`));
  }, [repo, pr]);

  const reviewFile = async (path: string) => {
    if (!repo || !pr) return;
    const [owner, name] = repo.full_name.split('/');
    setBusy(true);
    try {
      const meta = await window.electronAPI.githubGetPullRequest(owner, name, pr.number);
      const baseFile = await window.electronAPI.githubGetFile(owner, name, path, meta.baseSha).catch(() => ({ content: '', sha: '' }));
      const headFile = await window.electronAPI.githubGetFile(owner, name, path, meta.headSha);
      const tracked = toTrackedMarkdown(baseFile.content, headFile.content, meta.author, new Date(0).toISOString().slice(0, 10));
      onReview({ owner, repo: name, number: pr.number, title: pr.title, path }, tracked);
      onClose();
    } catch (e) {
      toast.error(`Could not load PR file: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-[34rem] max-w-[92vw] max-h-[85vh] overflow-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Review a Pull Request</h2>
          <button type="button" onClick={onClose} className="text-sm">Close</button>
        </div>
        {!repo ? (
          <ul className="divide-y">{repos.map((r) => <li key={r.full_name}><button type="button" className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setRepo(r)}>{r.full_name}</button></li>)}</ul>
        ) : !pr ? (
          <>
            <button type="button" onClick={() => setRepo(null)} className="text-blue-600 text-sm mb-2">← repos</button>
            <ul className="divide-y">{prs.map((p) => <li key={p.number}><button type="button" className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700" onClick={() => setPr(p)}>#{p.number} {p.title} <span className="text-gray-500">({p.user}: {p.head} → {p.base})</span></button></li>)}</ul>
            {prs.length === 0 && <div className="text-sm text-gray-500">No open pull requests.</div>}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setPr(null)} className="text-blue-600 text-sm mb-2">← pull requests</button>
            <div className="text-sm mb-2">#{pr.number} {pr.title}</div>
            <ul className="divide-y">{files.map((f) => <li key={f}><button type="button" disabled={busy} className="w-full text-left py-2 px-2 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50" onClick={() => reviewFile(f)}>📄 {f}</button></li>)}</ul>
            {files.length === 0 && <div className="text-sm text-gray-500">No changed markdown files in this PR.</div>}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit**

`npm run lint` → 0 errors; tsc shows no new errors in these files.
```
feat(github): review-session store state + Review-a-PR picker dialog
```

## Task 12: Review-mode banner + submit, menu entry, App wiring

**Files:**
- Create: `src/renderer/github/ReviewBanner.tsx`
- Modify: `src/main/menu.ts`, `src/renderer/components/App.tsx`

- [ ] **Step 1: Create the banner** — `src/renderer/github/ReviewBanner.tsx`:
```tsx
import React, { useState } from 'react';
import { useGitHubStore } from './github-store';
import { toast } from '../ui/toast/toast-store';

export function ReviewBanner({ onDone }: { onDone: () => void }) {
  const session = useGitHubStore((s) => s.reviewSession);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  if (!session) return null;

  const submit = async (event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT') => {
    setBusy(true);
    try {
      await window.electronAPI.githubSubmitReview(session.owner, session.repo, session.number, event, body);
      toast.success(`Review submitted (${event.replace('_', ' ').toLowerCase()})`);
      onDone();
    } catch (e) {
      toast.error(`Could not submit review: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-300 px-3 py-2 text-sm">
      <span className="font-medium">Reviewing PR #{session.number}: {session.title}</span>
      <input className="flex-1 min-w-[12rem] border rounded px-2 py-1 dark:bg-gray-900" placeholder="Review summary (optional)" value={body} onChange={(e) => setBody(e.target.value)} />
      <button type="button" disabled={busy} onClick={() => submit('APPROVE')} className="px-2 py-1 bg-emerald-600 text-white rounded disabled:opacity-50">Approve</button>
      <button type="button" disabled={busy} onClick={() => submit('REQUEST_CHANGES')} className="px-2 py-1 bg-red-600 text-white rounded disabled:opacity-50">Request changes</button>
      <button type="button" disabled={busy} onClick={() => submit('COMMENT')} className="px-2 py-1 border rounded disabled:opacity-50">Comment</button>
      <button type="button" onClick={onDone} className="px-2 py-1 border rounded">Done</button>
    </div>
  );
}
```

- [ ] **Step 2: Menu entry** — `src/main/menu.ts`, after "Save to GitHub...":
```ts
        { label: 'Review a Pull Request...', click: () => sendAction('github-review') },
```

- [ ] **Step 3: Wire into App** — `src/renderer/components/App.tsx`
  - Imports:
```tsx
import { ReviewPullRequestDialog } from '../github/ReviewPullRequestDialog';
import { ReviewBanner } from '../github/ReviewBanner';
import type { ReviewSession } from '../github/github-store';
```
  - Store reads: `const reviewMode = useGitHubStore((s) => s.reviewMode);` and grab `setReviewMode`, `setReviewSession` from the store getState in handlers.
  - State: `const [reviewDialogOpen, setReviewDialogOpen] = useState(false);`
  - Menu case: `case 'github-review': if (githubLogin) setReviewDialogOpen(true); else toast.info('Sign in to GitHub first.'); break;`
  - Enter review mode handler:
```tsx
  const enterReview = useCallback((session: ReviewSession, tracked: string) => {
    const doEnter = () => {
      setRawMode(false);
      rawContentRef.current = '';
      loadContent(tracked);
      setFile(null, session.path.split('/').pop() || session.path);
      setGithubSource(null);
      useGitHubStore.getState().setReviewSession(session);
      useGitHubStore.getState().setReviewMode(true);
      editor?.setEditable(false);
      setDirty(false);
      setComments(getMetadata().comments);
    };
    guardDirty('You have unsaved changes. Review this pull request anyway?', doEnter);
  }, [setRawMode, loadContent, setFile, setGithubSource, editor, setDirty, setComments, getMetadata, guardDirty]);

  const exitReview = useCallback(() => {
    useGitHubStore.getState().setReviewMode(false);
    useGitHubStore.getState().setReviewSession(null);
    editor?.setEditable(true);
    loadContent('');
    setFile(null, 'Untitled');
  }, [editor, loadContent, setFile]);
```
  - Render the banner above the editor area (when `reviewMode`) and the dialog with the other dialogs:
```tsx
      {reviewMode && <ReviewBanner onDone={exitReview} />}
      <ReviewPullRequestDialog open={reviewDialogOpen} onClose={() => setReviewDialogOpen(false)} onReview={enterReview} />
```
  - Guard editing/saving while reviewing: at the top of `handleSave`, add `if (useGitHubStore.getState().reviewMode) return;` so Ctrl+S is a no-op in review mode.

- [ ] **Step 4: Verify build**

`npm run lint` → 0 errors; `npx tsc --noEmit 2>&1 | Select-String 'github|App.tsx|menu.ts'` → only pre-existing App.tsx errors. `npm run package` → success.

- [ ] **Step 5: Commit**

```
feat(github): minimal read-only PR review mode (banner + submit review)
```

- [ ] **Step 6: Phase C manual check (controller)**

`npm start`, signed in: File → Review a Pull Request → pick repo → pick an open PR → pick a changed `.md` → editor shows the PR's changes as green/red track changes, read-only, with the review banner. Enter a summary, click Approve (on someone else's PR) → toast confirms and the review appears on GitHub. Approve your own PR → graceful error toast, not a crash. Click Done → returns to a blank editable doc.

---

# PHASE D — Documentation

## Task 13: Update README and CHANGELOG for the GitHub integration

Covers the whole GitHub story — the Phase 1 features already shipped on this branch (sign-in, Open from GitHub, commit-on-save) **and** this plan's additions (title/menu, Save to GitHub, PR review) — since they are not yet documented anywhere.

**Files:**
- Modify: `README.md`, `CHANGELOG.md`

- [ ] **Step 1: Add a GitHub section to the README**

In `README.md`, under `### File Handling` (after the "Linked files" bullet, before the `### Other` heading), add:
```markdown

### GitHub

- **Sign in with GitHub** — File → *Sign in to GitHub* uses GitHub's device-flow (a one-time code in your browser); the token is stored encrypted via the OS keystore. The signed-in user shows in the window title, and the menu offers *Sign out*.
- **Open from GitHub** — browse your repositories and open a Markdown file directly; saving commits it back.
- **Save to GitHub** — publish a local document to a repository: pick repo, folder, filename, branch (existing or a new `markover/…` branch), and a commit message. The document then stays linked to GitHub, so saving commits there.
- **Branch-protected repositories** — if a repository blocks direct changes to a branch, Markover offers to commit to another branch (or save a copy locally) instead of failing.
- **Review a pull request** — File → *Review a Pull Request* opens an open PR's Markdown changes as read-only track changes, and lets you Approve, Request changes, or Comment.

> **Note:** GitHub access uses a personal OAuth app and works with your personal repositories. Organisations that enforce SAML SSO or restrict third-party apps (e.g. WiseTech Global) need additional setup — see issue #24.
```

- [ ] **Step 2: Add a CHANGELOG entry**

In `CHANGELOG.md`, insert a new section immediately after the `---` on line 5 (above the `## [1.0.11]` entry):
```markdown

## [Unreleased]

### Added

- **GitHub integration** — sign in with GitHub (device flow; token encrypted via the OS keystore), Open a Markdown file from any repository, and commit edits back on save.
- **Save to GitHub** — publish a local or new document to a repository with a repo / folder / filename / branch / commit-message picker. New branches default to `markover/<filename>`. The document becomes GitHub-backed so subsequent saves commit there.
- **Branch-protection handling** — when a repository rejects a direct write (protected branch, missing permission, or SSO), Markover offers to choose another branch or save a copy locally instead of surfacing a raw error.
- **Review a pull request** — open a pull request's Markdown changes as read-only track changes and submit an Approve / Request changes / Comment review.
- **GitHub status in the window title and File menu** — the signed-in user appears in the title, and the menu toggles between *Sign in to GitHub* and *Sign out*. GitHub-opened files now update the window title correctly.

### Internal

- Headless unit tests for the window-title composer, branch-name helper, and the pull-request diff-to-track-changes converter (`scripts/test-github-units.ts`, additions to `scripts/roundtrip-test.ts`).

---
```

NOTE: the `## [Unreleased]` header is renamed to the real version (with its compare link and date) at release time, per the four-location version-bump process in `CLAUDE.md`. Do not bump the version here.

- [ ] **Step 3: Verify links/format**

Confirm the README renders (no broken Markdown) and the CHANGELOG keeps the existing `---`-separated structure. No build needed.

- [ ] **Step 4: Commit**

```
docs: document the GitHub integration in README and CHANGELOG
```

---

## Final verification (after all phases)

- [ ] `npx tsx scripts/roundtrip-test.ts` → all pass (includes the new pr-diff assertions).
- [ ] `npx tsx scripts/test-github-units.ts` → all pass.
- [ ] `npm run lint` → 0 errors.
- [ ] `npm run package` → success.
- [ ] Manual checklists from Tasks 4, 8, and 12.

## Out of scope (Phase 2 / issue #24)

Auto-opening a PR; inline line-anchored review comments; editing/pushing to a PR branch from review mode; word/inline-level diff; GitHub App / org install; SAML-SSO authorization UX.
