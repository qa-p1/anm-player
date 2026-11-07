# v0.3.0 release verification

Verified on 2026-11-08 against the release source.

## Application checks

- Frontend: 121 tests across 36 files; typecheck, ESLint, Knip and production build passed.
- Largest JavaScript chunk: 239.3 KiB, within the release limit.
- Backend: 303 tests passed with warnings treated as errors; coverage 78.60% (70% required).
- Every release-critical backend coverage gate passed (80% minimum per file).
- Ruff and Python dependency consistency checks passed.
- Runtime npm and pinned Python dependency audits reported no known vulnerabilities. The npm development-tool audit reported 11 moderate advisories and passed the existing critical-severity gate.

## Docker self-hosting

Built both production images from the release source using the pinned Dockerfile bases and lockfiles. Started an isolated Compose project with a generated operator token, a separate loopback port and fresh named volumes.

Verified:

- API database migrations and both container health checks.
- Version endpoint reports 0.3.0 through the web proxy.
- SPA deep links and production JavaScript assets.
- Playlist creation and a valid PNG cover upload larger than 1 MiB through Nginx; the resulting JPEG is served correctly.
- Byte-range audio streaming (`206 Partial Content`) through Nginx using a local WAV fixture.
- Download-event WebSocket upgrade (`101 Switching Protocols`).
- A downloadable SQLite database backup.
- The API runs as UID 10001, has no published host port and rejects unauthenticated direct requests.
- FFmpeg is available and `pip check` passes inside the API image.
- Legacy local music folders are absent from the built image.
- After removing and recreating the containers while retaining their volumes, the playlist, cover bytes, audio file and song database entry remain available.
- Production, development-only and merged Compose definitions validate.

The repeatable cover-upload and persistence check is in `scripts/check_docker_smoke.py` and the integration CI job. Its test playlist belongs only in a disposable stack. Development Compose was configuration-validated; runtime checks above used the production stack. External YouTube/lyrics availability is provider-dependent and is not established by the local-media Docker checks.

See [Advanced setup](advanced-setup.md#docker-quick-start) for installation, updates and persistent storage.
