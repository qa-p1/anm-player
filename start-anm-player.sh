#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

if command -v python3.13 >/dev/null 2>&1; then
  exec python3.13 scripts/start_aura.py "$@"
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 scripts/start_aura.py "$@"
fi
if command -v python >/dev/null 2>&1; then
  exec python scripts/start_aura.py "$@"
fi

echo "Python 3.13 or 3.14 was not found on PATH." >&2
exit 1
