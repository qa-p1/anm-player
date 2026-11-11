#!/bin/sh
# ANM Player setup for Linux and macOS. Download it and run it.
# Uses this computer's Python, Node.js and FFmpeg; anything missing is
# installed with your package manager (you may be asked for your password).
set -eu
BOOTSTRAP_URL=https://raw.githubusercontent.com/qa-p1/anm-player/main/scripts/bootstrap.py

fail() { printf '\n[setup] %s\n' "$*" >&2; exit 1; }
say() { printf '[setup] %s\n' "$*"; }
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --connect-timeout 30 --silent --show-error --output "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --tries=3 --timeout=30 --output-document="$2" "$1"
  else
    fail 'This computer needs curl or wget to download ANM Player.'
  fi
}
as_root() {
  if [ "$(id -u)" -eq 0 ]; then "$@"; else sudo "$@"; fi
}

case "$(uname -s)" in
  Darwin) ANM_DEFAULT_ROOT="$HOME/Library/Application Support/ANM Player"
          PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH ;;
  Linux) ANM_DEFAULT_ROOT="$HOME/.local/share/anm-player" ;;
  *) fail 'Use the Windows setup file on Windows. This one is for Linux and macOS.' ;;
esac

# A Python that ANM Player supports and that can create app environments.
find_python() {
  for candidate in python3.14 python3.13 python3; do
    if command -v "$candidate" >/dev/null 2>&1 &&
       "$candidate" -c 'import sys, venv, ensurepip; sys.exit(not (3, 13) <= sys.version_info[:2] < (3, 15))' >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

apt_has() { apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [0-9]'; }

install_python() {
  say 'Installing Python 3 for this computer. You may be asked for your password.'
  if command -v pacman >/dev/null 2>&1; then
    as_root pacman -S --needed --noconfirm python
  elif command -v apt-get >/dev/null 2>&1; then
    as_root apt-get update
    for version in 3.14 3.13; do
      if apt_has "python$version"; then
        as_root apt-get install -y "python$version" "python$version-venv"
        return 0
      fi
    done
    if [ -r /etc/os-release ] && grep -qi '^ID=ubuntu\|^ID_LIKE=.*ubuntu' /etc/os-release; then
      # Ubuntu's own Python is older; deadsnakes is the standard source for newer versions.
      as_root apt-get install -y software-properties-common
      as_root add-apt-repository -y ppa:deadsnakes/ppa
      as_root apt-get update
      as_root apt-get install -y python3.13 python3.13-venv
    else
      fail 'This system does not offer Python 3.13 or newer. Install Python 3.13, then run this file again.'
    fi
  elif command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y python3.13 || as_root dnf install -y python3
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install python313
  elif [ "$(uname -s)" = Darwin ]; then
    if ! command -v brew >/dev/null 2>&1; then
      say 'Installing Homebrew, the standard macOS package manager…'
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
    fi
    brew install python@3.13
  else
    fail 'Install Python 3.13 or 3.14 with your package manager, then run this file again.'
  fi
}

# Debian-based systems ship venv support separately from Python itself.
repair_venv() {
  for candidate in python3.14 python3.13 python3; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    version=$("$candidate" -c 'import sys; v = sys.version_info[:2]; print("%d.%d" % v if (3, 13) <= v < (3, 15) else "")' 2>/dev/null || true)
    if [ -n "$version" ] && command -v apt-get >/dev/null 2>&1; then
      say "Adding Python $version environment support…"
      as_root apt-get install -y "python$version-venv"
      return 0
    fi
  done
  return 1
}

ANM_ROOT=${ANM_INSTALL_ROOT:-$ANM_DEFAULT_ROOT}
mkdir -p "$ANM_ROOT"
ANM_ROOT=$(CDPATH= cd -- "$ANM_ROOT" && pwd)

printf '\nANM Player setup\nYour music and settings will live in: %s\n\n' "$ANM_ROOT"

PYTHON=$(find_python || true)
if [ -z "$PYTHON" ]; then
  repair_venv || install_python
  hash -r 2>/dev/null || true
  PYTHON=$(find_python || true)
  [ -n "$PYTHON" ] || fail 'Python 3.13 or 3.14 could not be set up. Install it with your package manager, then run this file again.'
fi
say "Using $("$PYTHON" --version) at $PYTHON"

ANM_STAGE=$(mktemp -d "$ANM_ROOT/.setup-XXXXXX")
trap 'rm -rf "$ANM_STAGE"' EXIT HUP INT TERM
fetch "$BOOTSTRAP_URL" "$ANM_STAGE/bootstrap.py"
mv "$ANM_STAGE/bootstrap.py" "$ANM_ROOT/bootstrap.py"

say 'Preparing ANM Player. The first start takes a few minutes…'
"$PYTHON" "$ANM_ROOT/bootstrap.py" --root "$ANM_ROOT" "$@"
