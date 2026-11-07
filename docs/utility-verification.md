# Utility upgrade verification

## Recovery and GitHub

- Before changes, local main and origin/main both pointed to `2ed3b12`.
- Recovery commit: `85a2c68`, pushed to main and tagged `checkpoint/pre-utility-2026-11-07` on GitHub.
- Deleted all nine live `dependabot/` branches and pruned obsolete remote-tracking references. Other branches were preserved.
- Set version-update PR limits to zero for each configured Dependabot ecosystem; security alerts remain enabled.
- Runtime media/cache files were neither committed nor deleted. Windows-style runtime storage folders on Unix are now ignored.

To inspect the original source without changing your working checkout, use `git show checkpoint/pre-utility-2026-11-07:<path>`. To work from the original source, use `git switch -c recovery/pre-utility checkpoint/pre-utility-2026-11-07`. This source checkpoint does not replace a separate backup of the music database and media.

## Checks passed

- Web: 96 tests across 27 files, including navigation accessibility, quick find, keyboard ownership, collection controls, filtered playlist selection, song multiselect, filter cancellation, stale search pagination, favorite refresh and player reopen, malformed persisted state, safe exports and batched status lookup.
- API: 279 tests; coverage 75.48%, exceeding the 70% gate. All critical-module coverage gates passed.
- Web lint, TypeScript, Knip, production build and bundle size checks. Largest JavaScript chunk: 239.3 KiB against a 500 KiB limit.
- Python Ruff and pip dependency consistency.
- Production and development Compose configuration validation.
- Git whitespace checks.
- Production npm audit: zero vulnerabilities. Full-tree audit: zero high or critical vulnerabilities after targeted patch updates to Solid/Seroval, Vite/Rolldown, Undici, Zod and selector-parser dependencies.

## Limits

- API tests emit one upstream Starlette/AnyIO deprecation warning. The warning-as-error CI invocation was not represented as passing.
- Eleven moderate npm audit entries remain in the development-only ESLint/minimatch tree; npm proposes a breaking tooling downgrade, which was not applied.
- UI verification here uses DOM interaction and accessibility tests. No live browser visual/device sweep, real audio-device listening test, Docker container integration run, or exhaustive live YouTube provider test was performed.
- M3U exports contain URLs to this app's running stream endpoints; the app must remain reachable. Playlist pins and saved queue snapshots are browser-local.

Structural decisions and follow-up review corrections are recorded in `utility-decisions.md` and `api-utility-decisions.md`.
