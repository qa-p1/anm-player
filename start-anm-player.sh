#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$SCRIPT_DIR"

# The shared launcher detaches both servers and exits once startup is complete.
# Use --stop to shut them down, or --foreground for live terminal logs.
if command -v python3.13 >/dev/null 2>&1; then
  exec python3.13 "$SCRIPT_DIR/scripts/start_aura.py" "$@"
fi
if command -v python3 >/dev/null 2>&1; then
  exec python3 "$SCRIPT_DIR/scripts/start_aura.py" "$@"
fi
if command -v python >/dev/null 2>&1; then
  exec python scripts/start_aura.py "$@"
fi

echo "Python 3.13 or 3.14 was not found on PATH." >&2
exit 1
