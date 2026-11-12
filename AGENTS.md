# Working on ANM Player

## Release notes are required

Installed copies update from `main`, and the update button shows the new
CHANGELOG entries in a small hover card. Every change users can notice must
add an entry before it reaches `main`.

- Add entries to the newest section of `CHANGELOG.md`. Between releases that is
  `## Unreleased`; a release renames it to `## X.Y.Z - YYYY-MM-DD` and bumps
  `VERSION`, `package.json`, `apps/web/package.json` and `package-lock.json`.
- One line per entry, exactly: `- **Short title**: One plain sentence.`
  The title is 3-48 characters; the whole entry stays under 200 characters.
- Write for listeners, not developers: what they can now do or what got better.
  No file names, function names, ticket numbers or "refactor".
- Put the most important entries first. The card shows the first five, then
  "Plus N more" and a link to the full changelog.
- Changes users never notice (tests, refactors, CI) need no entry: put
  `[no changelog]` in the commit message instead.

CI runs `python3 scripts/check_changelog.py <base>` and fails when app files
change without an entry or when an entry breaks the format. Run it locally
before pushing.

## Checks before pushing

- Web (`apps/web`): `npx tsc -b --noEmit`, `npx eslint src`, `npx knip`, `npx vitest run`.
- API (`apps/api`): `.venv/bin/ruff check . ../../scripts`, `.venv/bin/python -m pytest -q -W error`.
