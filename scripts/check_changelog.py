#!/usr/bin/env python3
"""Release-notes gate: app changes need a changelog entry the update popup can show.

Usage: check_changelog.py [BASE_REF]

* Every entry in the newest CHANGELOG section must read
  ``- **Short title**: one plain sentence.`` and stay short, because the in-app
  update button shows these entries as they are.
* With BASE_REF, changes to the app since that commit must also touch
  CHANGELOG.md, unless a commit message in the range says ``[no changelog]``
  (for refactors, tests and tooling users never notice).
"""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRY = re.compile(r"^\*\*(?P<title>[^*]{3,48})\*\*: (?P<text>[^\n]{10,})$")
MAX_ENTRY = 200
APP_PATHS = ("apps/", "scripts/", "setup-anm-player", "start-anm-player", "docker/")
IGNORED = re.compile(r"(^|/)(tests?|__tests__)/|\.test\.(ts|tsx)$|^scripts/check_")


def newest_section(text: str) -> tuple[str, list[str]]:
    heading, entries = "", []
    for line in text.splitlines():
        if line.startswith("## "):
            if heading:
                break
            heading = line[3:].strip()
        elif heading and line.startswith("- "):
            entries.append(line[2:].strip())
        elif heading and entries and line.startswith("  ") and line.strip():
            entries[-1] += " " + line.strip()
    return heading, entries


def format_problems(text: str) -> list[str]:
    heading, entries = newest_section(text)
    if not heading:
        return ["CHANGELOG.md has no '## ' section."]
    if not entries:
        return [f"The newest section ({heading}) has no entries."]
    problems = []
    for entry in entries:
        if not ENTRY.match(entry):
            problems.append(f"Use '- **Short title**: one sentence.' (title 3-48 characters): {entry[:90]}")
        elif len(entry) > MAX_ENTRY:
            problems.append(f"Keep entries under {MAX_ENTRY} characters ({len(entry)}): {entry[:90]}")
    return problems


def git(*arguments: str) -> str:
    return subprocess.run(["git", *arguments], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def missing_entry(base: str) -> str | None:
    changed = [path for path in git("diff", "--name-only", f"{base}...HEAD").splitlines() if path]
    app_changes = [path for path in changed if path.startswith(APP_PATHS) and not IGNORED.search(path)]
    if not app_changes or "CHANGELOG.md" in changed:
        return None
    if "[no changelog]" in git("log", "--format=%B", f"{base}..HEAD"):
        return None
    return f"App files changed without a CHANGELOG.md entry (e.g. {app_changes[0]}). Add one, or put [no changelog] in a commit message if users won't notice the change."


def main(argv: list[str]) -> int:
    problems = format_problems((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"))
    if len(argv) > 1 and argv[1].strip("0"):
        missing = missing_entry(argv[1])
        if missing:
            problems.append(missing)
    for problem in problems:
        print(f"::error file=CHANGELOG.md::{problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
