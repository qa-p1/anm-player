#!/bin/sh
# Download this file and run it. All tools stay inside ANM Player's user folder.
set -eu
UV_VERSION=0.13.7
BOOTSTRAP_URL=https://raw.githubusercontent.com/qa-p1/anm-player/v1.0.0/scripts/bootstrap.py

fail() { printf '\n[setup] %s\n' "$*" >&2; exit 1; }
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --connect-timeout 30 --output "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --tries=3 --timeout=30 --output-document="$2" "$1"
  else
    fail 'This computer needs curl or wget to download the app.'
  fi
}

case "$(uname -s)" in
  Darwin) ANM_DEFAULT_ROOT="$HOME/Library/Application Support/ANM Player"; ANM_OS=apple-darwin ;;
  Linux) ANM_DEFAULT_ROOT="$HOME/.local/share/anm-player"; ANM_OS=unknown-linux-gnu ;;
  *) fail 'Use setup-anm-player.cmd on Windows. This script supports macOS and Linux.' ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ANM_ARCH=x86_64 ;;
  arm64|aarch64) ANM_ARCH=aarch64 ;;
  *) fail 'Automatic setup needs a 64-bit Intel/AMD or ARM computer.' ;;
esac
ANM_ROOT=${ANM_INSTALL_ROOT:-$ANM_DEFAULT_ROOT}
mkdir -p "$ANM_ROOT/tools/uv"
ANM_ROOT=$(CDPATH= cd -- "$ANM_ROOT" && pwd)
export ANM_INSTALL_ROOT="$ANM_ROOT"
export UV_PYTHON_INSTALL_DIR="$ANM_ROOT/tools/python"
export UV_PYTHON_BIN_DIR="$ANM_ROOT/tools/python-bin"
export UV_PYTHON_INSTALL_BIN=0
export UV_CACHE_DIR="$ANM_ROOT/tools/cache"
export UV_NO_MODIFY_PATH=1
ANM_STAGE=$(mktemp -d "$ANM_ROOT/.setup-XXXXXX")
trap 'rm -rf "$ANM_STAGE"' EXIT HUP INT TERM
ANM_UV="$ANM_ROOT/tools/uv/uv"

printf '\nANM Player setup\nYour music and settings will live in: %s\n\n' "$ANM_ROOT"
if [ ! -x "$ANM_UV" ]; then
  ANM_ARCHIVE="uv-$ANM_ARCH-$ANM_OS.tar.gz"
  ANM_URL="https://github.com/astral-sh/uv/releases/download/$UV_VERSION/$ANM_ARCHIVE"
  printf '[setup] Downloading the private Python manager…\n'
  fetch "$ANM_URL" "$ANM_STAGE/uv.tar.gz"
  fetch "$ANM_URL.sha256" "$ANM_STAGE/uv.sha256"
  ANM_EXPECTED=$(awk '{print $1; exit}' "$ANM_STAGE/uv.sha256")
  if command -v sha256sum >/dev/null 2>&1; then
    ANM_ACTUAL=$(sha256sum "$ANM_STAGE/uv.tar.gz" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    ANM_ACTUAL=$(shasum -a 256 "$ANM_STAGE/uv.tar.gz" | awk '{print $1}')
  else
    fail 'A SHA-256 utility is required to verify the Python manager.'
  fi
  [ "$ANM_ACTUAL" = "$ANM_EXPECTED" ] || fail 'Download integrity check failed. Run setup again to retry.'
  tar -xzf "$ANM_STAGE/uv.tar.gz" -C "$ANM_STAGE"
  ANM_EXTRACTED_UV="$ANM_STAGE/uv-$ANM_ARCH-$ANM_OS/uv"
  [ -f "$ANM_EXTRACTED_UV" ] || fail 'The Python manager archive was incomplete.'
  cp "$ANM_EXTRACTED_UV" "$ANM_UV"
  chmod 755 "$ANM_UV"
fi
if [ ! -f "$ANM_ROOT/bootstrap.py" ]; then
  fetch "$BOOTSTRAP_URL" "$ANM_STAGE/bootstrap.py"
  mv "$ANM_STAGE/bootstrap.py" "$ANM_ROOT/bootstrap.py"
fi
printf '[setup] Preparing Python and the app. The first start takes a few minutes…\n'
"$ANM_UV" run --no-config --no-project --managed-python --python 3.13 "$ANM_ROOT/bootstrap.py" --root "$ANM_ROOT" "$@"
