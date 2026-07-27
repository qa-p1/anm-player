from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
VERSION = (REPOSITORY_ROOT / "VERSION").read_text(encoding="utf-8").strip()

if not VERSION:
    raise RuntimeError("VERSION must not be empty")
