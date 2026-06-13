# Vite Upgrade — Scope

**Date:** 2026-06-13
**Purpose:** Clear the remaining Dependabot advisories (`esbuild` high, `vite` ×2 moderate) that are gated behind the Vite version. All are **dev-server-only** — they do not affect the packaged app or production builds — so this is hygiene/build-environment hardening, not a user-facing security fix.

## Key finding: the "blocker" is a dead dependency

The project was believed to be pinned to `vite@5` because `@vitejs/plugin-react@6` requires `vite@^8` (the reason `npm install` needs `--legacy-peer-deps`). Investigation shows:

- **`@vitejs/plugin-react` is not imported anywhere.** `vite.renderer.config.ts` transpiles JSX via `esbuild: { jsx: 'automatic' }`; no vite config calls `react()`. The package is a leftover devDependency.
- **`@tailwindcss/vite` is also unused.** Tailwind is wired through `postcss.config.js` (`@tailwindcss/postcss`), not the Vite plugin.

So the peer conflict is **artificial**. Removing these two dead devDependencies removes the conflict and likely lets `--legacy-peer-deps` be dropped — independent of any Vite version bump.

## Current state

| Package | Current | Notes |
| --- | --- | --- |
| vite | ^5.4.21 | used only via `@electron-forge/plugin-vite` + the three `vite.*.config.ts` files |
| @vitejs/plugin-react | ^6.0.0 | **unused** — remove |
| @tailwindcss/vite | ^4.2.1 | **unused** — remove |
| @tailwindcss/postcss | ^4.2.1 | actual Tailwind integration (keep) |
| @electron-forge/plugin-vite | ^7.11.1 | declares **no** vite peer; supported vite range is the main unknown |

The vite config files use only stable surface: `defineConfig`, `resolve.alias`, `esbuild.jsx`, `server.watch.ignored`, and the forge-injected entries. No vite-major-specific plugin APIs — so the upgrade risk is concentrated in **electron-forge's Vite plugin**, not our config.

## Advisory targets

- `vite` moderate ×2 — first patched at **6.4.2**; latest is **8.0.16**. Any vite ≥ 6.4.2 clears the current vite advisories.
- `esbuild` high — vulnerable `< 0.28.1`. **Only vite 8 (rolldown era) currently ships esbuild ≥ 0.28.1.** Vite 6/7 use esbuild ~0.25/0.27, which clears the esbuild *medium/low* but **not** the high. (Confirmed empirically: force-overriding esbuild to 0.28.1 under vite 5 breaks the build — `[vite:esbuild-transpile] … not supported yet` — so esbuild can only advance when Vite does.)

So:
- **Vite 7** → clears the vite advisories + esbuild medium/low; **esbuild high may remain**.
- **Vite 8** → clears everything, but uses **Rolldown** (a Rust bundler replacing Rollup) — a major architecture change that `@electron-forge/plugin-vite@7.11` may not yet support. **Highest risk.**

## Recommended approach (incremental, spike-first)

**Phase 0 — remove the dead deps (do now, ~15 min, near-zero risk).**
- Delete `@vitejs/plugin-react` and `@tailwindcss/vite` from `devDependencies`.
- `npm install` (try WITHOUT `--legacy-peer-deps`; if it now resolves cleanly, update the note in `CLAUDE.md` that documents the conflict).
- Verify: `npm run lint`, `npx tsx scripts/roundtrip-test.ts`, `npx tsx scripts/test-github-units.ts`, `npm run package`, and `npm start` (dev server) all work.
- This alone resolves the "blocked by plugin-react peer conflict" framing and is independently shippable.

**Phase 1 — bump Vite to 7 (spike, then commit if green).**
- Bump `vite` to `^7` and `@electron-forge/*` to the latest 7.11.x (7.11.2). Also bump `@tailwindcss/postcss`/`tailwindcss` if needed (latest tailwind v4 supports vite 5–8).
- The validation gate is **`@electron-forge/plugin-vite` on vite 7**: run `npm start` (dev server + HMR), then `npm run package` and `npm run make`, then the Playwright e2e (`npm test`). If the forge vite plugin errors on vite 7, stop — this is blocked until electron-forge supports it; report and hold.
- Expected outcome: clears the `vite` advisories and the esbuild medium/low. Re-check `npm audit`.

**Phase 2 — esbuild high (only if it still shows after Phase 1).**
- Option A: try an `esbuild` override to `^0.28.1` *on vite 7* (vite 7's esbuild API is much closer to 0.28 than vite 5's was; may work where vite 5 failed) — verify the full build.
- Option B: go to **vite 8** — only if `@electron-forge/plugin-vite` has added Rolldown support by then. Treat as its own spike with the same build/e2e gate; high risk, likely a wait on electron-forge.

## Risks & unknowns

1. **electron-forge ↔ vite 7/8 support** is the dominant risk and the first thing to validate. Forge 7.11 was built in the vite 5/6 era; vite 7 (still Rollup) is plausible, vite 8 (Rolldown) is doubtful until a newer forge.
2. The `appVersion` in `forge.config.ts` and the e2e fuse plumbing (`MARKOVER_TEST_BUILD`) must keep working across the bundler change — covered by running `npm test`.
3. Dropping `--legacy-peer-deps` may surface other latent peer issues; keep the flag if so and note why.

## Effort & sequencing

- Phase 0: ~15 min, low risk — worth doing immediately (and arguably independent of the upgrade).
- Phase 1 (vite 7 spike + verify): ~1–3 hrs depending on forge compatibility.
- Phase 2 (esbuild high / vite 8): bounded by external electron-forge Rolldown support; may be a "wait and revisit."

## Bottom line

The remaining 3 alerts are dev-only and the path is clear but gated on electron-forge's Vite support. **Phase 0 (remove dead deps) is a safe immediate win.** Vite 7 is the realistic next target and should clear the vite advisories; the esbuild *high* may require vite 8/Rolldown, which depends on electron-forge catching up — so it may legitimately remain open for a while, and that's an acceptable, documented state given it's a dev-server-only issue.
