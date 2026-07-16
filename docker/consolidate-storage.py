"""Copy legacy split Aura mounts into one verified data root without deleting them."""

from __future__ import annotations

import argparse
import hashlib
import shutil
from pathlib import Path


def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def copy_tree(source: Path, destination: Path) -> tuple[int, int]:
    files = bytes_copied = 0
    if not source.exists():
        return files, bytes_copied
    for item in sorted(path for path in source.rglob("*") if path.is_file()):
        relative = item.relative_to(source)
        output = destination / relative
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, output)
        if item.stat().st_size != output.stat().st_size or digest(item) != digest(output):
            raise RuntimeError(f"Verification failed for {item}")
        files += 1
        bytes_copied += item.stat().st_size
    return files, bytes_copied


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, type=Path)
    parser.add_argument("--database", required=True, type=Path, help="Legacy aura.db file")
    for name in ("music", "downloads", "cache", "config", "thumbnails", "logs"):
        parser.add_argument(f"--{name}", type=Path)
    args = parser.parse_args()
    target = args.target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    if any(target.iterdir()):
        raise SystemExit(f"Target must be empty: {target}")
    if not args.database.is_file():
        raise SystemExit(f"Database does not exist: {args.database}")

    shutil.copy2(args.database, target / "aura.db")
    if digest(args.database) != digest(target / "aura.db"):
        raise SystemExit("Database verification failed")
    total_files, total_bytes = 1, args.database.stat().st_size
    for name in ("music", "downloads", "cache", "config", "thumbnails", "logs"):
        source = getattr(args, name)
        if source:
            files, size = copy_tree(source.resolve(), target / name)
            total_files += files
            total_bytes += size
    print(f"Verified {total_files} files ({total_bytes} bytes) in {target}")
    print("Legacy sources were not modified or deleted.")


if __name__ == "__main__":
    main()
