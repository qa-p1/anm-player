# ANM Player

ANM Player (Another Music Player) is a single-user music library and player that I run on a local computer. It can browse YouTube Music, stream a track, save music for offline playback, and keep local albums, playlists, favorites, lyrics, and listening history together.

This is deliberately not a public music service. ANM Player has one operator token and assumes every person who can reach its web interface is trusted. The default Docker and native setups bind to `127.0.0.1` for that reason.

There is no current screenshot in the repository; I would rather leave this section plain than publish an image that no longer matches the interface.

## What works today

- YouTube Music home, search, album, artist, related-track browsing, autoplay radio, and recent or pinned searches
- Streaming with visible buffering/error states, retry-and-skip recovery, a persistent editable queue, shuffle, repeat-one, and repeat-all
- Advanced playback controls including speed, pitch preservation, configurable seek steps, output-device selection, A-B repeat, bookmarks, and sleep/stop timers
- A ten-band equalizer with presets, preamp, stereo balance, mono downmix, and normalization
- Media Session controls, an expanded keyboard shortcut system, a rich mini player, and offline/reconnection feedback
- Background downloads through yt-dlp and FFmpeg, with live progress, pause/resume, cancel, and single or bulk retry
- Local songs, artists, albums, saved online albums, favorites, and mixed local/online playlists with editing, duplication, drag reordering, bulk actions, sharing, and M3U8 export
- Synced lyrics with per-track timing offsets and display controls, plus editable local lyrics, metadata, and artwork enrichment
- Listening insights for time, streaks, daily/hourly activity, and top tracks, artists, and albums, with replayable and manageable history
- Managed SQLite storage with in-app reconciliation, usage reporting, cache cleanup, live database backups, verified moves, and a guarded fresh start
- Responsive desktop and narrow layouts with reduced-motion support

See [CHANGELOG.md](CHANGELOG.md) for the complete v0.2.0 expansion list.

Provider responses and stream formats can change without notice. ANM Player also has no accounts, remote synchronization, DRM support, or provider-independent catalog.

## Docker quick start

Docker Compose is the recommended way to run ANM Player. It publishes only the Nginx web service on loopback; the API remains on the internal Compose network.

Clone the repository and create the local environment file:

```powershell
git clone https://github.com/qa-p1/anm-player.git
Set-Location anm-player
Copy-Item .env.example .env
py -3.13 -c "from pathlib import Path; import secrets; p=Path('.env'); s=p.read_text(); p.write_text(s.replace('API_ACCESS_TOKEN=', 'API_ACCESS_TOKEN='+secrets.token_urlsafe(48), 1))"
docker compose up --build -d
```

On macOS or Linux:

```bash
git clone https://github.com/qa-p1/anm-player.git
cd anm-player
cp .env.example .env
python3.13 -c "from pathlib import Path; import secrets; p=Path('.env'); s=p.read_text(); p.write_text(s.replace('API_ACCESS_TOKEN=', 'API_ACCESS_TOKEN='+secrets.token_urlsafe(48), 1))"
docker compose up --build -d
```

Open <http://127.0.0.1:5173>. Stop the stack with `docker compose down`. Named volumes keep the database and media between starts; `docker compose down --volumes` deletes those volumes and should not be used unless that is intentional.

## Double-click and run

The native launcher is the simplest option when Docker is not wanted. It requires Python 3.13, Node.js 24 LTS, npm, and FFmpeg on `PATH`.

1. Clone the repository or extract a downloaded source archive.
2. On Windows, double-click `start-anm-player.cmd`.
3. On macOS or Linux, run `chmod +x start-anm-player.sh` once, then run `./start-anm-player.sh`.
4. Leave the terminal open. The first run creates `apps/api/.venv`, installs pinned Python and npm dependencies, creates `.env`, generates an API token, applies database migrations, and starts both servers.
5. The browser opens only after the API and web server are ready. First setup can take several minutes; later starts skip dependency installation while the lockfiles are unchanged.

Press `Ctrl+C` in the launcher terminal to stop both servers. If either child process fails, the launcher stops the other one and prints a recovery message.

Available launcher flags:

```text
--no-browser
--setup-only
--force-install
--api-port PORT
--web-port PORT
```

Both wrappers resolve the repository root before invoking the shared launcher, including when the checkout path contains spaces.

## Native installation by hand

The launcher is preferred because it handles token generation and coordinated shutdown. For a manual Windows PowerShell setup:

```powershell
py -3.13 -m venv apps/api/.venv
apps/api/.venv/Scripts/python.exe -m pip install -r apps/api/requirements.txt
npm ci
Copy-Item .env.example .env
# Set API_ACCESS_TOKEN in .env to a generated URL-safe secret before continuing.
Set-Location apps/api
.venv/Scripts/python.exe -m alembic upgrade head
.venv/Scripts/python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal from the repository root, run `npm run dev`. On Unix, replace the virtual-environment executable with `apps/api/.venv/bin/python` and use `python3.13 -m venv apps/api/.venv`.

The native web interface is <http://127.0.0.1:5173>. Vite proxies same-origin API and WebSocket requests to the backend and adds the operator token server-side.

## Environment

`.env.example` contains only boot and deployment settings. Playback, download format, enrichment, retention, and album parallelism are managed in ANM Player's Settings page and stored in SQLite.

| Variable | Default/example | Purpose |
| --- | --- | --- |
| `COMPOSE_PROJECT_NAME` | `anm-player` | Stable Compose project and volume prefix |
| `WEB_BIND_HOST` | `127.0.0.1` | Host interface published by the production web container |
| `WEB_PORT` | `5173` | Web port |
| `API_ENV` | `production` | Strict runtime mode: `production`, `development`, or `test` |
| `API_ACCESS_TOKEN` | blank | Operator token; required in production and generated by the launcher |
| `API_TRUSTED_HOSTS` | `localhost,127.0.0.1` | Comma-separated accepted Host headers |
| `AURA_DATA_ROOT` | `./data` | Initial managed data root for native runs |
| `AURA_STATE_FILE` | `./.aura/storage-state.json` | Durable pointer to the active data root |
| `DOWNLOAD_WORKER_POLL_INTERVAL_SECONDS` | `1` | Worker polling interval |
| `STREAM_FETCH_MAX_CONCURRENCY` | `2` | Maximum concurrent stream-cache downloads |
| `STREAM_MAX_FILE_MB` | `256` | Per-stream cache file limit |
| `STREAM_CACHE_BUDGET_MB` | `2048` | Total stream-cache budget |
| `ARTWORK_MAX_RESPONSE_MB` | `12` | Artwork response limit |
| `ARTWORK_MAX_PIXELS` | `40000000` | Maximum decoded artwork dimensions by pixel count |
| `ARTWORK_MAX_CONCURRENCY` | `4` | Concurrent artwork cache writes |

Relative storage paths are resolved from the repository, not from the shell's current directory. An existing `.env` is never replaced by the launcher. A blank token is filled once; an explicit placeholder is rejected so it cannot silently reach production.

## Storage and backups

The managed root contains:

```text
aura.db
music/
downloads/jobs/
cache/artwork/
cache/lyrics/
cache/streams/
config/
thumbnails/downloads/
logs/
```

The small state file at `.aura/storage-state.json` points to the active root. Docker uses the `aura-data` and `aura-state` named volumes under the Compose project prefix.

For the library database alone, **Download Database Backup** in Settings saves a consistent snapshot without stopping ANM Player. It does not include music files or caches.

For a complete backup, stop ANM Player first. Copy or archive both the complete data root and the state file together. For Docker, stop the stack and back up both named volumes with the volume-backup method used by your Docker installation. Verify that the archive contains `aura.db`, then retain an older known-good backup before testing a restore.

Storage moves started from Settings are gated while active. Same-device moves are renamed and verified; cross-device moves are copied with a full SHA-256 manifest and SQLite `PRAGMA quick_check` before ANM Player switches roots. The old root is not removed before verification. If cleanup fails, ANM Player keeps recovery state and leaves both copies in place.

Settings also has **Sync library now** for reconciling database download state with files in the managed music directory. ANM Player runs a lightweight reconciliation in the background, but the button is useful after manually copying or removing files while ANM Player was stopped.

The **Fresh start** action in Settings is intentionally destructive. It requires a new, empty, non-overlapping directory and the exact confirmation text `RESET ANM PLAYER`. ANM Player creates and verifies a clean database in that directory before deleting its old `aura.db`, music, downloads, artwork, lyrics, streams, thumbnails, configuration, and logs. Browser player/theme state is cleared after the switch. Unrelated files in an accidentally broad old root are never deleted, and a cleanup failure leaves a visible recovery warning.

For an older split-volume installation, stop every ANM Player API, worker, launcher, and container process, prepare a new absent or empty target, and run:

```bash
python docker/consolidate-storage.py --confirm-app-stopped \
  --target /new-data --database /legacy-db/aura.db \
  --music /legacy-music --downloads /legacy-downloads --cache /legacy-cache \
  --config /legacy-config --thumbnails /legacy-thumbnails --logs /legacy-logs
```

The helper rejects overlapping paths and symbolic links, uses SQLite's backup API, verifies every copied file, stages the result atomically, and never deletes a legacy source. Keep those sources until ANM Player has started successfully from the new root.

## Development

The repository is split into a React/Vite client and a FastAPI service:

```text
apps/web/       React, TypeScript, Vite, Vitest
apps/api/       FastAPI, SQLAlchemy, Alembic, pytest
docker/         production images, Nginx, migration helper
scripts/        launcher and release checks
.github/        CI and dependency update configuration
```

Install development dependencies:

```powershell
apps/api/.venv/Scripts/python.exe -m pip install -r apps/api/requirements-dev.txt
npm ci
```

Useful checks from the repository root:

```powershell
Set-Location apps/api
.venv/Scripts/python.exe -m ruff check app tests ../../scripts
.venv/Scripts/python.exe -W error -m pytest --cov=app --cov-fail-under=70
Set-Location ../..
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run check:bundle
npm audit --omit=dev --audit-level=high
npm audit --audit-level=critical
docker compose config --quiet
docker compose -f docker-compose.dev.yml config --quiet
```

Runtime Python dependencies are in `apps/api/requirements.txt`; test, lint, coverage, and audit tools are in `apps/api/requirements-dev.txt`.

## Troubleshooting

- **Port already in use:** stop the stale process or use `.\start-anm-player.cmd --api-port 8010 --web-port 5180`. Docker's web port is controlled by `WEB_PORT`.
- **FFmpeg not found:** install FFmpeg and confirm `ffmpeg -version` works in a new terminal.
- **Wrong Python or Node version:** use Python 3.13 and Node 24 LTS. The launcher also accepts the tested adjacent Python 3.14 and Node 25/26 runtimes, but the release reference and CI versions are 3.13 and 24.
- **Migration failed:** stop ANM Player, preserve the complete data root and state file, then run `apps/api/.venv/Scripts/python.exe -m alembic current` from `apps/api`. Do not delete a source root or migration state to force progress.
- **Stale native processes:** close old launcher terminals and stop remaining `uvicorn`, `node`, or `npm` processes before restarting.
- **Docker will not start:** confirm Docker Desktop's Linux engine is running, then rerun `docker compose config` before rebuilding.
- **Provider request failed:** retry later and check `data/logs`. YouTube Music and yt-dlp changes can temporarily break search, streaming, or downloads even when ANM Player itself is unchanged.

## Security and remote access

ANM Player's bearer token is intentionally kept out of browser code, URLs, storage, and built assets. Nginx or the Vite development proxy injects it into same-origin upstream requests. The production API port is not published.

This does not make ANM Player safe to expose directly to a LAN or the internet. Every visitor who reaches the web UI effectively has operator access. Keep `WEB_BIND_HOST=127.0.0.1`; for remote use, add a separately authenticated reverse proxy or a private VPN and restrict it to trusted people. See [SECURITY.md](SECURITY.md) for vulnerability reporting.

## Provider and legal note

ANM Player depends on YouTube Music, yt-dlp, and third-party lyrics/metadata behavior. Use it only for media you are entitled to access, follow provider terms, and comply with copyright law in your jurisdiction. The maintainers do not grant rights to music or provider content and cannot determine whether a particular download is lawful for you.

Authenticated API documentation is available at <http://127.0.0.1:5173/api/v1/docs> while ANM Player is running.

ANM Player is released under the [MIT License](LICENSE).
