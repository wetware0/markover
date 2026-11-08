# Contributing to Markover

Thanks for your interest in Markover! Bug reports, feature requests, and pull requests are all welcome.

## Reporting bugs

If something doesn't work the way you expect, please [open an issue](https://github.com/wetware0/markover/issues/new). A good bug report includes:

- What you did (steps to reproduce)
- What you expected to happen
- What actually happened
- Your OS and Markover version (Help → About, or check `package.json`)
- A sample `.md` file if the bug is content-specific

Screenshots or short screen recordings are a huge help for editor-behaviour bugs.

## Requesting features

Feature ideas also go in [GitHub issues](https://github.com/wetware0/markover/issues/new) — please describe the problem you're trying to solve, not just the feature you have in mind. That helps work out whether there's a simpler or more general solution.

## Reporting security issues

Please **do not** file public issues for security vulnerabilities.

- Preferred: open a private advisory via [GitHub Security Advisories](https://github.com/wetware0/markover/security/advisories/new)
- Alternative: email me directly at [peter@williams-family.com.au](mailto:peter@williams-family.com.au)

I'll acknowledge security reports within a few days.

## Pull requests

Small fixes and improvements are very welcome. For anything non-trivial, please open an issue first so we can agree on the approach before you spend time on it.

Before submitting a PR:

- `npm run lint` passes
- `npx tsx scripts/roundtrip-test.ts` passes (fast headless markdown roundtrip suite)
- `npm test` passes if you've touched anything the Playwright e2e suite covers

See [CLAUDE.md](./CLAUDE.md) for architecture notes and conventions baked into the codebase.

## Code of conduct

Be kind. Assume good intent. That's the whole code of conduct.
