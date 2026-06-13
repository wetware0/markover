# GitHub Session UX, Save-to-GitHub & Minimal PR Review — Design

**Date:** 2026-06-13
**Status:** Draft — pending user review
**Builds on:** GitHub integration Phase 1 (PR #23 — device-flow sign-in, Open/Save from GitHub). Client ID `Ov23lig2zUXLYnrLHbfu` (personal pilot). Larger items remain in [[github-integration-pilot]] / issue #24.

## Problem

After signing in to GitHub the app looks identical — no signed-in indicator, and File → "Sign in to GitHub" stays put. Three concrete gaps and one larger ask surfaced:

1. No GitHub status in the window; and GitHub-opened files don't update the window title **at all** (the title is derived in the main process from `currentFilePath`, which GitHub opens never set).
2. The File menu can't toggle to "Sign out."
3. A local/new document can't be published to GitHub — `handleSave` only commits when the doc was *opened* from GitHub.
4. There's no way to review a pull request inside Markover.

## Decisions (from brainstorming)

- **Window title:** `filename — Markover`, plus ` · GitHub: <user>` when signed in. Same format for local and GitHub-backed files.
- **Close action:** not added — File → New already returns to a blank Untitled doc.
- **Save-to-GitHub model:** after publishing, the document **becomes GitHub-backed** (subsequent `Ctrl+S` commits to that repo/path), mirroring Open-from-GitHub.
- **Sign-out:** detaches any open GitHub-backed doc to local (content kept, GitHub link dropped, next save is Save-As); confirm only if there are unsaved changes.
- **Protected/non-writable branches:** user can **pick an existing branch or create a new one** (default `markover/<filename>`); if even that write is rejected, fall back to a clear message + Save-locally. (Auto-opening a PR is deferred.)
- **PR review:** include a **minimal, read-only** slice — list PRs, view one changed markdown file's changes as **line/block-level** track changes, submit an overall Approve / Request changes / Comment review. Inline line-anchored comments and editing/pushing to the PR are deferred.

## Architecture

### Session-state plumbing (Approach A — one channel)

The renderer holds everything the title and menu need (signed-in login in `useGitHubStore`; document name and GitHub-backed status in renderer state). The window title and native menu live in the main process. Bridge them with a **single renderer→main IPC**, `SESSION_STATE`, carrying `{ documentName: string, githubLogin: string | null }`.

- Main keeps `githubLogin` in a module variable, composes the title (`` `${documentName} — Markover` `` + `` ` · GitHub: ${githubLogin}` `` when signed in) and calls `mainWindow.setTitle(...)`. This **replaces** `currentFilePath`-derived title-setting, so every document type updates the title (fixes the GitHub-title bug). `currentFilePath` remains for Save-As default path and asset resolution.
- When `githubLogin` changes, main calls `rebuildMenu()` so the Sign-in/out label flips.
- The renderer fires `SESSION_STATE` from one `useEffect` keyed on the current document name and `useGitHubStore`'s `login`.

This is one channel, one source of truth (the renderer), and folds the title-bug fix in for free. Rejected alternatives: piecemeal channels with main still deriving the title from `currentFilePath` (two fighting sources); renderer setting the full title string itself (still needs a second channel for the menu).

### State (renderer)

`useGitHubStore` (existing) gains:
- `reviewSession: { owner, repo, number, title, path, baseSha, headSha } | null`
- `reviewMode: boolean` (read-only review active)

`source` (GitHubSource) and `login` already exist.

## Components

### 1. Window title indicator
- **`src/shared/types/ipc.ts`** — add channel `SESSION_STATE: 'session:state'`; add `ElectronAPI.notifySessionState(documentName: string, githubLogin: string | null): void`.
- **`src/main/preload.ts`** — expose `notifySessionState` via `ipcRenderer.send`.
- **`src/main/main.ts`** — `ipcMain.on(SESSION_STATE, …)` stores `documentName`/`githubLogin`, composes + sets the title, and `rebuildMenu()` if login changed. Remove the title-setting from the existing `updateTitle()`/open/save paths (or have them no-op the title and let the renderer drive it). Pure helper `composeTitle(documentName, login)` for unit testing.
- **`src/renderer/components/App.tsx`** — a `useEffect` that calls `notifySessionState(currentDocName, login)` whenever the document name or `login` changes. `currentDocName` comes from the editor store's file name (or `'Untitled'`).

### 2. Sign in ⇄ Sign out menu toggle
- **`src/main/menu.ts`** — `buildMenu` gains a `githubLogin: string | null` parameter. File menu: when null, "Sign in to GitHub…" → `sendAction('github-sign-in')`; when set, "Sign out of GitHub (<login>)" → `sendAction('github-sign-out')`. Keep "Open from GitHub…"; add "Save to GitHub…" and "Review a Pull Request…" (both enabled regardless of menu state; they no-op with a "sign in first" toast if signed out).
- **`src/main/main.ts`** — `rebuildMenu()` passes the stored `githubLogin` into `buildMenu`.
- **`src/renderer/components/App.tsx`** — handle `github-sign-out`: if dirty, confirm; then `await githubSignOut()` (clears token — exists), `setLogin(null)`, `setGithubSource(null)` (detach to local), toast "Signed out of GitHub." The `SESSION_STATE` effect then flips the menu and drops the title suffix.

### 3. Save local/new file to GitHub
- **`src/main/github/api.ts`** — add:
  - `listBranches(owner, repo): Promise<{ name: string; protected: boolean }[]>`
  - `getBranchHeadSha(owner, repo, branch): Promise<string>`
  - `createBranch(owner, repo, newBranch, fromSha): Promise<void>` (`POST /git/refs`, `ref: refs/heads/<newBranch>`).
- **IPC/preload** — expose the three new methods (mirror existing `github*` wiring in `ipc.ts`/`preload.ts`).
- **`src/renderer/github/SaveToGitHubDialog.tsx`** (new) — reuses `OpenFromGitHubDialog`'s repo/folder browsing; adds: filename field, branch step (radio list of existing branches with default + protected labels, plus "New branch: `markover/<filename>`"), commit-message field. On commit:
  - New branch → `getBranchHeadSha(default)` → `createBranch` → `putFile` (no sha; creates the file).
  - Existing branch → `putFile` (look up the file's sha first if it already exists there).
  - On success: `setGithubSource({owner, repo, branch, path, sha})`, `setFile(null, filename)`, `setDirty(false)`, toast. If a non-default branch: toast "Committed to `<branch>` — open a pull request on GitHub to merge."
- **Entry:** menu action `github-save-as` → opens the dialog (signed-in only; else "sign in first" toast).
- **Graceful fallback (shared):** a helper that, on a rejected write (`403/404/409/422`), shows a dialog — "`owner/repo` blocks direct changes to `<branch>`. Choose another branch, or save a copy locally." — with **[Choose another branch] / [Save locally] / [Cancel]**. "Choose another branch" re-opens the branch step. This wraps both the SaveToGitHub commit **and** a rejected `Ctrl+S` on an already-GitHub-backed file (Section in `handleSave`).

### 4. Review a Pull Request (minimal, read-only)
- **`src/main/github/api.ts`** — add:
  - `listPullRequests(owner, repo): Promise<{ number, title, user, base, head, updated_at }[]>`
  - `listPullRequestFiles(owner, repo, number): Promise<{ filename, status }[]>`
  - `getPullRequest(owner, repo, number): Promise<{ baseSha, headSha, baseRef, headRef, author }>`
  - `submitReview(owner, repo, number, event: 'APPROVE'|'REQUEST_CHANGES'|'COMMENT', body: string): Promise<void>`
- **IPC/preload** — expose the four methods.
- **`src/renderer/github/pr-diff.ts`** (new) — pure function `toTrackedMarkdown(baseMd, headMd, author, date): string`. Computes a **line/block-level** diff (simple LCS over blocks, or the `diff` library) and emits a markdown string with the existing `<span data-markov="del" …>` / `<span data-markov="ins" …>` markers around changed blocks — i.e., the same format the parser already converts (`src/renderer/editor/markdown/parser.ts`). This reuses the entire existing track-changes rendering path. Unit-testable in the headless harness (string in → string out).
- **`src/renderer/github/ReviewPullRequestDialog.tsx`** (new) — repo picker → open PR list → if multiple changed `.md` files, file picker. On select: fetch the file at `baseSha` and `headSha` (`getFile` with ref), run `toTrackedMarkdown`, `loadContent(tracked)`, set `reviewMode=true` + `reviewSession`.
- **Review mode UI (App.tsx + a banner component):** editor read-only (`editor.setEditable(false)`); a banner "Reviewing PR #N — <title>" with **Approve / Request changes / Comment** buttons and a summary text box → `submitReview`; a **Done** button exits (`reviewMode=false`, `guardDirty`-free since read-only, load blank). Track Changes panel shows the changes (read-only; accept/reject hidden in review mode). Save and edit affordances disabled while `reviewMode`.
- **Entry:** menu action `github-review` (signed-in only).
- **Graceful rules:** approving your own PR / lacking review permission / SSO → the shared clear-message fallback, not a raw error.

## Data flow

- **Title/menu:** renderer state change → `notifySessionState` → main composes title + (if login changed) rebuilds menu.
- **Save to GitHub:** dialog → (createBranch?) → putFile → set GitHubSource → future `Ctrl+S` → `githubPutFile`. Rejection → graceful dialog.
- **PR review:** dialog → getPullRequest + getFile(base/head) → `toTrackedMarkdown` → read-only editor + banner → submitReview.

## Error handling

- All GitHub write/permission rejections (`403/404/409/422`) route through the shared graceful dialog ("choose another branch / save locally"), never a raw error toast.
- Signed-out use of Save-to-GitHub / Review → "Sign in to GitHub first" toast.
- Network/API failures on list/get → toast with the message (matches existing dialogs).

## Testing

- **Headless (roundtrip harness):** unit-test `composeTitle(documentName, login)` (pure), the new-vs-existing-branch decision (pure), and `toTrackedMarkdown(base, head, …)` (string→string; assert ins/del markers around changed blocks and that the output round-trips through the existing parser). These run in `scripts/roundtrip-test.ts` style.
- **Manual checklist:** sign in → title shows user + menu flips to Sign out; open from GitHub → title shows filename; Save to GitHub to a personal repo default branch → commit appears; Save to a new branch → branch + commit appear, toast points to PR; attempt save to a protected branch → graceful dialog (choose-branch / save-local), not a raw error; sign out with a GitHub doc open → detaches, title drops user, next save is Save-As; Review a PR → changes show as track changes, Approve/Request changes submits and appears on GitHub; approve-own-PR → graceful message.

## Scope boundaries (deferred — Phase 2 / issue #24)

- Auto-opening a pull request on the user's behalf.
- Inline, line-anchored PR review comments (the GitHub-diff-line ↔ Markover-text-range anchor mapping).
- Editing a PR and pushing commits back to its branch from review mode.
- Word/inline-level diff granularity.
- GitHub App / org installation, SAML-SSO authorization UX (WiseTech Global enablement).

## Components summary (one responsibility each)

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `SESSION_STATE` IPC + `composeTitle` | renderer→main title/login sync; title string | — |
| `buildMenu(githubLogin)` | sign-in/out toggle + GitHub menu items | login from main |
| `api.ts` branch fns | list/create branches, head sha | token-store |
| `SaveToGitHubDialog` | publish local doc → repo/branch/path | api, github-store |
| graceful-write helper | uniform protected/permission fallback | dialogs/toast |
| `api.ts` PR fns | list PRs/files, get PR, submit review | token-store |
| `pr-diff.toTrackedMarkdown` | base+head → tracked-changes markdown | — (pure) |
| `ReviewPullRequestDialog` + review mode | drive review, read-only render, submit | api, github-store, pr-diff |
