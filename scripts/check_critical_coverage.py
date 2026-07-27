#!/usr/bin/env python3
"""Enforce per-file coverage for release-critical backend code."""

from __future__ import annotations

import json
import sys
from pathlib import Path


MINIMUM = 80.0
CRITICAL_FILES = (
    "app/api/deps.py",
    "app/services/artwork_cache.py",
    "app/services/stream_cache.py",
    "app/storage/coordinator.py",
    "app/workers/downloads/worker.py",
)


def main() -> int:
    report = json.loads(Path("coverage.json").read_text(encoding="utf-8"))
    files = {name.replace("\\", "/"): data for name, data in report["files"].items()}
    failures: list[str] = []
    for name in CRITICAL_FILES:
        summary = files.get(name, {}).get("summary")
        if not summary:
            failures.append(f"{name}: missing from coverage report")
            continue
        percent = float(summary["percent_covered"])
        print(f"{name}: {percent:.1f}%")
        if percent < MINIMUM:
            failures.append(f"{name}: {percent:.1f}% is below {MINIMUM:.0f}%")
    if failures:
        print("\n".join(failures), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
