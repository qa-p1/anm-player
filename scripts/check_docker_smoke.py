#!/usr/bin/env python3
"""Exercise a disposable Compose stack, including cover uploads and persistence.

Run create before recreating the containers, then verify with the same state file.
Never point this check at a personal library: it creates and removes a test playlist.
Only the Python standard library is needed on the host.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import struct
import urllib.request
import zlib
from pathlib import Path
from uuid import uuid4


def cover_png() -> bytes:
    """Valid noise PNG above Nginx's default 1 MiB request limit."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))

    size = 768
    rng = random.Random(0)
    pixels = b"".join(b"\0" + rng.randbytes(size * 3) for _ in range(size))
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!2I5B", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")
    if not 1024 * 1024 < len(png) < 10 * 1024 * 1024:
        raise RuntimeError("Cover fixture must be between 1 and 10 MiB")
    return png


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("create", "verify"))
    parser.add_argument("--base-url", default="http://127.0.0.1:5173")
    parser.add_argument("--state-file", type=Path, required=True)
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    def request(path: str, *, method: str = "GET", body: bytes | None = None, content_type: str = "application/json") -> bytes:
        req = urllib.request.Request(base + path, data=body, method=method, headers={"Content-Type": content_type})
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read()

    if request("/health").strip() != b"ok":
        raise RuntimeError("Web health check failed")
    if json.loads(request("/api/v1/health"))["status"] != "ok":
        raise RuntimeError("API health check failed")
    version = json.loads(request("/api/v1/health/version"))["version"]
    expected_version = (Path(__file__).resolve().parent.parent / "VERSION").read_text().strip()
    if version != expected_version:
        raise RuntimeError(f"Expected {expected_version}, got {version}")

    if args.stage == "create":
        html = request("/library/albums").decode()
        if '<div id="root"></div>' not in html:
            raise RuntimeError("SPA deep link failed")
        assets = re.findall(r'(/assets/[^" ]+\.js)', html)
        if not assets or not request(assets[0]):
            raise RuntimeError("Production JavaScript asset missing")
        name = f"Docker release persistence check {uuid4().hex[:8]}"
        playlist = json.loads(request("/api/v1/playlists", method="POST", body=json.dumps({"name": name}).encode()))
        playlist_path = f"/api/v1/playlists/{playlist['id']}"
        uploaded = json.loads(request(playlist_path + "/artwork", method="PUT", body=cover_png(), content_type="image/png"))
        artwork_path = uploaded["artwork_path"]
        if not artwork_path.startswith("/api/v1/media/artwork/playlists/"):
            raise RuntimeError(f"Unexpected cover path: {artwork_path}")
        cover = request(artwork_path)
        if not cover.startswith(b"\xff\xd8"):
            raise RuntimeError("Uploaded cover did not return a JPEG")
        args.state_file.parent.mkdir(parents=True, exist_ok=True)
        args.state_file.write_text(json.dumps({"name": name, "playlist_path": playlist_path, "artwork_path": artwork_path, "sha256": hashlib.sha256(cover).hexdigest()}))
        print(f"v{version}: health, API proxy, SPA, assets, playlist creation and >1 MiB cover upload passed.")
    else:
        state = json.loads(args.state_file.read_text())
        playlist = json.loads(request(state["playlist_path"]))
        if playlist["name"] != state["name"] or playlist["artwork_path"] != state["artwork_path"]:
            raise RuntimeError("Playlist did not survive container recreation")
        cover = request(state["artwork_path"])
        if hashlib.sha256(cover).hexdigest() != state["sha256"]:
            raise RuntimeError("Playlist cover did not survive container recreation")
        request(state["playlist_path"], method="DELETE")
        args.state_file.unlink()
        print("Database and uploaded cover survived container recreation; test playlist removed.")


if __name__ == "__main__":
    main()
