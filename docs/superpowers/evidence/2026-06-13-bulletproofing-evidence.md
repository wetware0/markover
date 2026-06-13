# Execution Evidence — Bulletproofing + GitHub Phase 1

Plan: `docs/superpowers/plans/2026-06-13-bulletproofing-and-github-phase-1.md`
Branch: `bulletproofing-and-github-phase-1`
Process: each task implemented by a subagent (Sonnet), then independently verified by the controller (Fable) in two stages — spec compliance review of the diff, then code-quality review — with all test runs re-executed by the controller, not taken from agent reports.

Baseline before execution: roundtrip suite 62 passed / 0 failed.

---

## Task 1 — Fix task-list parsing (issue #22)

**Commits:**
- `f07d736` fix(parser): correctly handle task lists with formatting and nesting (#22)
- `40d169b` fix(parser): record task-list looseness at parse time instead of guessing (review-driven fix)

**What changed:** Replaced the regex-based HTML rewrite of `markdown-it-task-lists` output with a token-stream core rule (`markover_task_items`) in `parser.ts`; dropped the plugin's buggy `label/labelAfter` options (source of the unclosed `<strong>` + duplicated `**…**` text). Serializer `taskList` handler now indents nested block children and preserves loose/tight item spacing. New `MarkoverTaskList` extension records list looseness (`data-loose`) at parse time, used by both the editor stack and the test harness.

**TDD evidence (from implementer run, verified by controller):**
- Before fix, with 5 new test cases added: `62 passed, 5 failed (67 total)` — failures showed the exact issue #22 symptoms (raw `**…**` text duplicated into labels, unconverted `task-list-item` items).
- After fix: `67 passed, 0 failed`.

**Controller review findings:**
1. ✅ Spec compliance: all 5 plan-specified test cases added verbatim; regex block deleted; plugin options changed; rule correctly anchored after `github-task-lists` (an improvement over the plan's `'inline'` anchor — the plugin itself runs after `inline`).
2. ❌ Quality issue found (independently reproduced by controller with a probe case): the serializer treated any nested list inside a task item as making the list "loose", violating the CLAUDE.md convention and inserting a blank line on round-trip of `- [ ] a\n  - sub\n- [ ] b\n`:
   ```
   input:  "- [ ] a\n  - sub\n- [ ] b\n"
   got:    "- [ ] a\n  - sub\n\n- [ ] b\n"   ← drift
   ```
3. Fix dispatched and verified: looseness is now detected at parse time (markdown-it marks tight-list paragraph tokens `hidden=true`; visible paragraphs at the list's direct item level ⇒ loose) and carried on the node as a `loose` attribute, so the serializer no longer guesses. A permanent regression case `tight task list with nested bullets stays tight` was added.

**Controller-verified final state:**
```
> npx tsx scripts/roundtrip-test.ts
68 passed, 0 failed (68 total)
```
Covers (new cases): bold task label; bold label + nested bullets; two loose bold tasks with nested bullets (the issue #22 sample shape); inline-code label; mixed checked/unchecked with formatting; tight nested multi-item list stays tight.

Lint: 0 errors (warnings pre-existing).

---

## Task 2 — Mermaid advisories + XSS error path (issue #16)

**Commit:** `7fb58f9` fix(security): patch Mermaid advisories and escape mermaid error output (#16)

**What changed:** `mermaid ^11.13.0 → ^11.15.0` — all four Dependabot advisories (CSS injection via config, HTML injection via `classDef`, CSS injection via `classDefs`, Gantt infinite-loop DoS) report `first_patched_version` = 11.15.0. The `mermaid-block.ts` error path no longer assigns raw diagram source to `innerHTML`; it now builds a `<pre class="mermaid-error">` via `textContent` (XSS sink closed).

**Controller-verified evidence:**
```
> npm audit | Select-String mermaid   → 0 matches (was 4 advisories against 11.0.0-alpha.1 – 11.14.0)
> npx tsx scripts/roundtrip-test.ts   → 68 passed, 0 failed
```
Diff reviewed: exactly 3 files (package.json, package-lock.json, mermaid-block.ts); the legitimate `dom.innerHTML = svg` line (Mermaid's sanitized output) untouched per spec.

Note for backlog: `npm audit` still reports 15 other pre-existing vulnerabilities unrelated to mermaid — out of scope here, consistent with the repo's history of dependency-override commits.

---

## Task 3 — Scope the markover-asset protocol (security)

**Commit:** `af6fc54` fix(security): restrict markover-asset protocol to the document directory tree

**What changed:** Added an `isPathInside` helper and a containment gate in the `markover-asset` protocol handler in `main.ts`. After the existing path-resolution branches, the resolved `absolutePath` is now rejected with HTTP 403 unless it resolves inside the open document's directory or its git root; with no file open, 404. Closes the arbitrary-local-file-read amplifier for any renderer HTML injection.

**Controller review:** Diff is 18 added lines, single file, existing resolution logic untouched (gate appended only). `path.resolve` + `path.relative` containment check correctly rejects `..` traversal and absolute escapes. `npx tsc --noEmit` adds no new errors; lint unchanged (0 errors).

---

## Task 4 — Confirm before launching executables (security)

**Commit:** `c7c6390` fix(security): confirm before opening executable files from a document

**What changed:** `SHELL_OPEN_PATH` handler in `main.ts` is now `async`; before `shell.openPath`, paths matching `/\.(exe|bat|cmd|com|scr|ps1|msi|vbs|js|jar|app|sh)$/i` trigger a warning dialog defaulting to Cancel. The `https?://` → `openExternal` branch is untouched.

**Controller review:** Diff matches spec exactly; safe default (`defaultId/cancelId` = Cancel). Lint clean.

---

## Phase 3 — Data safety (Tasks 5–8)

All four commits reviewed diff-by-diff by the controller; full suite re-run after the phase: **68 passed, 0 failed**; lint **0 errors, 32 warnings** (all pre-existing).

Note on `npx tsc --noEmit`: the repo has ~9 pre-existing type errors in renderer files (TipTap `Storage` indexing in track-changes/find-replace/use-editor, missing `@types` for markdown-it-task-lists/footnote, a CodeBlockView tag type). The project builds via Vite and gates on `npm run lint`, not `tsc`; none of these are in files we touched and none were introduced. Flagged for the backlog.

- **Task 5 — toast primitive.** Commit `6235273`. New `src/renderer/ui/toast/{toast-store.ts,ToastHost.tsx}`; `<ToastHost />` mounted as the last child of App's outermost layout div. `toast.success/info/error` helpers; errors are sticky (ttl 0). Controller confirmed placement and that it renders nothing when empty.
- **Task 6 — atomic saves.** Commit `0c24e85`. Added `atomicWrite` (temp `.<name>.<rand>.tmp` + `handle.sync()` + `fs.rename`). Applied to exactly the three document/PDF write sites (FILE_SAVE, FILE_SAVE_AS, EXPORT_PDF); the recent-files JSON write left alone. Controller verified the three-and-only-three sites.
- **Task 7 — surface save failures.** Commit `9eb2421`. `SaveResult.error?` added; both save handlers return the real OS error message; `handleSave`/`handleSaveAs` now toast green "Saved" / sticky red "Save failed: …". User-cancel of Save As correctly produces no toast.
- **Task 8 — external-change detection.** Commit (latest). Main tracks `lastKnownMtimeMs` on open (both open paths) and after every write; `FILE_SAVE` gains a `force` flag and returns `{conflict:true}` when the on-disk mtime is newer (with a +1ms tolerance to avoid self-trigger); renderer prompts "changed on disk … overwrite?" and re-saves with `force=true` on confirm. Controller verified the conflict only arms for the currently-open file and `force` bypasses it.

**Manual verification still owed (controller, requires launching the app):** atomic-save leaves no `.tmp` files; read-only target shows the error toast; editing a file changed by another program triggers the conflict prompt. These are GUI behaviours the headless suite can't exercise; noted as a pending manual checklist at the end of this document.

---

## Phase 4 — Codec robustness (Tasks 9–10 so far)

### Task 9 — escape quotes in metadata attributes

**Commit:** `fix(codec): escape quotes in metadata attributes for safe round-trip` (suite 68 → 69).

**What changed:** `serializer.ts` gained `escAttr` (`&`→`&amp;`, `"`→`&quot;`) applied to all 10 attribute positions (comment id/author/date/status, reply id/parentId/author/date, fileMeta author name/color); `parser.ts` gained `unescAttr` applied in `parseAttrs` and `parseFileMeta`. Body content is not escaped.

**Controller-found nuance + direct verification:** the harness case the agent added (`&quot;` in input) passes both before and after the fix — it's a symmetry guard, not a true failing-first test, because the old code echoed `&quot;` verbatim. The *real* bug is a literal `"` in an in-memory value. I verified the actual fix with a throwaway script driving the codec directly:
```
metadata author "John \"JJ\" & Co"
 → serialized: author="John &quot;JJ&quot; &amp; Co"
 → re-parsed : "John \"JJ\" & Co"   ✅ literal quotes + ampersand survive
fileMeta author "A \"B\""           ✅ survives
```
A permanent serialize→parse regression case for this is added in Task 11.

### Task 10 — validate metadata offsets + warn on dangling collaboration data

**Commits:** initial `fix(codec): validate metadata offsets…` then review-driven `fix(codec): …warn only on genuinely dangling collaboration data`.

**What changed:** validator gained an `out_of_bounds` type and an optional `docLength` parameter with bounds checks on highlights/insertions/deletions. Load path (both file-open sites in App.tsx) warns via toast when collaboration data has issues.

**Controller-found defect (would have shipped a false alarm) + fix:** the validator cross-checks `metadata.highlights` against comments, but the parser never populates `metadata.highlights` (highlights are inline `<span data-markov="hl">` markers left in the markdown). I reproduced that a *normal* commented file therefore yielded a bogus `orphaned_comment`, which the new load-time toast would have surfaced on **every** document containing a comment. Fixes:
1. Controller passed `docLength` (recovered via `parseMarkoverFile(data.content).cleanMarkdown.length`) at both load sites so the bounds check is actually active, not dead code.
2. Guarded the `orphaned_highlight`/`orphaned_comment` cross-checks behind `metadata.highlights.length > 0` so they never false-fire under the real (untracked-highlights) representation.
3. Replaced the user-facing warning condition with one meaningful for this codec: a comment is "dangling" if no `data-comment-id="<id>"` span exists in the document (the genuine corruption when anchored text is deleted elsewhere).

**Verified (throwaway script, 8/8 PASS):** normal commented file → 0 problems (no false toast); comment whose highlight span is absent → 1 problem; duplicate reply ids → still flagged. Suite 69/0, lint clean.

### Task 11 — malformed-input degradation tests + permanent literal-quote regression

**Commits:** `test(codec): cover malformed metadata degradation and literal-quote round-trip` and `test(codec): make roundtrip summary total match actual assertions run`.

**What changed:** Three malformed-input cases added (unmatched end marker ignored; comment missing required attrs defaults safely without crashing; malformed `version: abc` falls back to 1) — all pass with **no codec source changes**, proving the codec already degrades gracefully. Added a permanent serialize→parse assertion locking in the Task 9 literal-quote fix (`John "JJ" & Co` survives). Controller fixed the summary line so the printed total counts the extra assertions (was "73 passed (72 total)").

**Notable:** the plan's expected output for the malformed-version case (`Body.\n`) was wrong — the codec correctly re-emits a `version: 1` meta block, which is non-lossy degraded behaviour, so the agent set `expected` to the real output with a rationale comment. Controller confirmed that's genuinely correct, not a masked bug.

**Controller-verified final state:** `npx tsx scripts/roundtrip-test.ts` → **73 passed, 0 failed (73 total)**; lint 0 errors.

---

## Phase 5 — Track-changes integrity (Task 12)

**Commit:** `8b18777` feat(track-changes): warn when a structural edit cannot be tracked.

**What changed:** The track-changes plugin's silent `catch` (which let untrackable structural edits through invisibly) now dispatches a `markover:untracked-edit` DOM event; App.tsx listens and shows a throttled (4s) info toast. No other plugin logic touched. Controller verified the diff is exactly the catch block + one new effect with correct add/remove cleanup.

---

## Phase 6 — GitHub integration Phase 1 (Tasks 13–19)

GitHub REST API over OAuth **device flow** — no git binary, no clone, no working tree. Seven commits, each reviewed by the controller:

| Commit | Task | Summary |
| --- | --- | --- |
| `f75ae75` | 13 | `src/main/github/token-store.ts` — token encrypted at rest via Electron `safeStorage`. |
| `e142292` | 14 | `auth.ts` — device-flow start + poll (`GITHUB_CLIENT_ID` placeholder, see below). |
| `62b3077` | 15 | `api.ts` — minimal REST client (user, repos, contents, get/put file). |
| `b2caaeb` | 16 | IPC wiring: 8 channels + `ElectronAPI` methods + `github/ipc.ts` handlers + preload + `registerGitHubHandlers()` in main. |
| `2c1377d` | 17 | `github-store.ts` (Zustand) + `GitHubSignInDialog.tsx`. |
| `374a6c0` | 18 | `OpenFromGitHubDialog.tsx` + App.tsx wiring (loader, source-clearing at all 3 local-load sites, menu cases, dialog render) + File-menu entries. |
| `c1994a2` | 19 | `handleSave` commits back to GitHub when the doc came from GitHub (refreshes blob `sha` after each commit). |

Tasks 14 and 15 were run **concurrently** (separate new files, no shared edits) — the only parallel dispatch; all others sequential to avoid shared-file conflicts.

**Controller end-to-end build verification:** `npm run package` (the real Vite + Electron-Forge gate for all three bundles — main, preload, renderer) **completed successfully** with all the new GitHub code included. `npx tsc --noEmit` adds no new errors beyond the pre-existing renderer set; lint 0 errors.

**Requires the user before GitHub features work end-to-end:**
1. Register a GitHub OAuth App with **Device Flow** enabled and paste its Client ID into `GITHUB_CLIENT_ID` in `src/main/github/auth.ts` (currently the literal `REPLACE_WITH_OAUTH_APP_CLIENT_ID`). Until then sign-in calls GitHub with an invalid client and fails gracefully (error toast).
2. Manual sign-in test (below) — device flow involves a real browser approval the headless build can't exercise.

---

## Environment note (for reproducing these runs)

Git for Windows at `C:\Program Files\Git` is corrupted on this machine (`BUG (fork bomb)` on every invocation), so all git operations used GitHub Desktop's bundled git: `$env:PATH = "$env:LOCALAPPDATA\GitHubDesktop\app-3.5.12\resources\app\git\cmd;$env:PATH"`. The Claude Bash tool was unusable; everything ran via PowerShell. This did not affect the code, only the tooling path.

---

## Automated verification — final

- `npx tsx scripts/roundtrip-test.ts` → **73 passed, 0 failed**.
- `npm run lint` → **0 errors**, 32 warnings (all pre-existing).
- `npm run package` (Vite + Forge build of all bundles) → **success**.
- `npm audit | grep mermaid` → **0** (issue #16 advisories cleared).
- Pre-existing `npx tsc --noEmit` errors (~9, renderer-only: TipTap `Storage` indexing, missing markdown-it `@types`, a CodeBlockView tag type) are unchanged and out of scope; the project builds via Vite, not tsc. Recommended backlog item.

## Manual verification still owed (require launching `npm start` — GUI behaviours the headless suite cannot exercise)

- [ ] **#22:** a task list with bold headings + nested sub-bullets renders correctly (no stray `**`, no run-on bold).
- [ ] **#16:** an invalid mermaid block containing `<img onerror=…>` shows source as plain text, no script runs.
- [ ] **Atomic save:** repeated saves leave no `.tmp` files in the document directory.
- [ ] **Save error:** saving to a read-only location shows a sticky red error toast with the OS reason.
- [ ] **External change:** editing a file changed by another program triggers the overwrite/cancel prompt.
- [ ] **Exec guard:** clicking a link/attachment to a `.bat`/`.exe` shows the warning dialog (Cancel by default).
- [ ] **GitHub (after Client ID set):** Sign in → device code in browser → "Signed in" toast; Open from GitHub → pick repo → open `.md`; edit + Ctrl+S → "Saved to GitHub" + commit appears on GitHub; File → New then save → prompts for a local path (GitHub source cleared).
- [ ] Recommended: run the Playwright e2e suite (`npm test`) once on a machine with a working build toolchain.
