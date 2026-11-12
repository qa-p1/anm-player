# Advanced setup and maintenance

This page holds the technical details that used to live in the README: Docker, the launcher flags, manual installation, environment variables, storage, backups and development. For everyday use, see the [README](../README.md).

## Automatic desktop setup and updates

Use the [setup downloads in the README](../README.md) for normal desktop use. The app and your library live under:

- Windows: `%LOCALAPPDATA%\ANMPlayer`
- macOS: `~/Library/Application Support/ANM Player`
- Linux: `~/.local/share/anm-player`

Setup uses the Python (3.13 or 3.14), Node.js (24–26) and FFmpeg already installed on the computer. Anything missing or too old is installed system-wide with the platform's package manager: pacman, apt (adding NodeSource for Node 24 and deadsnakes on Ubuntu when needed), dnf, zypper, Homebrew on macOS, or winget/Chocolatey on Windows. On Linux and macOS this asks for your password (`sudo`, or the desktop's password dialog when started from the launcher). Only the app's own libraries live in the install folder: a Python virtual environment built from the system Python, and `node_modules`.

Setup adds **ANM Player** to the app launcher (`~/.local/share/applications` on Linux, `~/Applications` on macOS, the Start menu on Windows) and to the desktop where one is shown. It starts without a terminal window; if launching fails you get a notification, and details are in `launch.log` in the install folder. Installs made by earlier setups that downloaded their own Python, Node and FFmpeg into `tools/` are switched over automatically the next time setup or the launcher runs; the library is kept.

The install folder contains a stable `.env`, `storage-state.json`, user `data/` and app source copies. `current.json` selects the active copy after an update. Keep the entire install folder for a full backup; a database-only backup remains available in Settings. Do not move the install folder by hand because storage paths are absolute.

The in-app button checks the `main` branch of `qa-p1/anm-player` by commit ID, so a fresh release/tag is not required for each improvement. Installing downloads that exact commit archive, installs that copy's Python and npm libraries, builds the web app and restarts the launcher. Source checkouts also stage updates separately; their Git working files are not overwritten. The original start script follows `current.json` after a successful update.

Before database migrations, the launcher stops its servers and makes a verified SQLite backup. If the replacement fails to start, the database is restored and the old app is restarted. Success keeps the active app, one preceding source/dependency copy and two database backups, and deletes older marked app copies plus the update's download caches. Music and configuration are outside those copies. Installer logs live under the install folder; update logs are rotated. If you close the machine during setup, rerun the launch shortcut and retry the update. Restore `current.json` to its `previous_root` only while the app is stopped if manual recovery is needed; database migrations can also require restoring the matching backup.

Docker users continue with Compose below. The app intentionally does not mount the Docker socket or attempt to rebuild its own containers.

## Docker quick start

Docker packages the web app, API, FFmpeg and their dependencies together. You only need Docker Desktop (with Linux containers), or Docker Engine with the Compose plugin. You do not need Python or Node installed on the host.

1. Download and extract the [latest release](https://github.com/qa-p1/anm-player/releases/latest), or clone this repository. Open a terminal in its folder.
2. Copy `.env.example` to `.env` (`cp .env.example .env` on Mac/Linux, or `Copy-Item .env.example .env` in PowerShell).
3. Generate a secret with:

   ```sh
   docker run --rm python:3.14-slim python -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

   Open `.env` in a text editor and paste the result after `API_ACCESS_TOKEN=`. Keep this file private.
4. Start the app:

   ```sh
   docker compose up --build --detach --wait
   ```

The first build takes a few minutes. Open <http://127.0.0.1:5173> when both services are healthy. Only the web service is published, on loopback; the API stays inside Docker's network. Change `WEB_PORT` in `.env` if another app already uses 5173.

### Stop, restart and update

- **Stop:** `docker compose down`
- **Start again:** `docker compose up --detach --wait`
- **Update a Git checkout:** back up your data, run `git pull --ff-only`, then `docker compose up --build --detach --wait`.
- **Update a downloaded release:** use the new release folder, copy your existing `.env` into it, and run the same build command. Keep `COMPOSE_PROJECT_NAME` unchanged so Docker reconnects the existing volumes.
- **Check status:** `docker compose ps`
- **Read logs:** `docker compose logs --tail=100 api web`

The in-app power button is for native launcher sessions. Manage Docker with Compose.

The `aura-data` volume holds the database, music, playlist covers and caches; `aura-state` holds the storage pointer. Both survive container rebuilds and replacement. **Do not use `docker compose down --volumes` unless you mean to delete your library.** Containers run with their own filesystem paths: keep storage under `/data`, or explicitly mount another persistent location before selecting it in Settings. A path elsewhere inside a container will not survive its replacement.

### On your own server

Install Docker on the server and follow the steps above. For private access from another computer, leave the default loopback binding and open an SSH tunnel:

```sh
ssh -N -L 5173:127.0.0.1:5173 you@your-server
```

Then open <http://127.0.0.1:5173> on your computer while the tunnel is running. For a domain name or shared access, use an authenticated reverse proxy or a private VPN; see [Security and remote access](#security-and-remote-access). The app is single-user and does not provide a login screen.

## Double-click and run

The native launcher is the simplest option when Docker is not wanted. It requires Python 3.13, Node.js 24 LTS, npm, and FFmpeg on `PATH`.

1. Clone the repository or extract a downloaded source archive.
2. On Windows, double-click `start-anm-player.cmd`.
3. On macOS or Linux, run `chmod +x start-anm-player.sh` once, then run `./start-anm-player.sh`.
4. The first run creates `apps/api/.venv`, installs pinned Python and npm dependencies, creates `.env`, generates an API token, applies database migrations, and starts both servers in the background.
5. The browser opens only after the API and web server are ready, then the launcher exits. A terminal opened just for the launcher can close; the app keeps running on Windows, macOS, and Linux. If you ran the command in an existing terminal, it returns to your prompt and you can close that terminal. First setup can take several minutes; later starts skip dependency installation while the lockfiles are unchanged.

Run `./start-anm-player.sh --stop` on macOS/Linux or `start-anm-player.cmd --stop` on Windows to stop both servers. Running the launcher again while the app is already running opens the existing instance. Background logs are saved to `.aura/launcher.log`. If either server fails, the background launcher stops the other and records the failure there.

You can also select **Close app** at the bottom of the sidebar (or in Settings on smaller screens). This stops playback and shuts down both servers; the browser displays a message that you can close the tab. The launcher also cleans up leftover API/Vite processes belonging to this checkout when starting or stopping. Other programs using the same ports are left alone.

In fish, bash, and zsh, include `./` when running the shell script from the project folder: `./start-anm-player.sh`. The `.cmd` file is for Windows. Open `http://127.0.0.1:5173/` to use the app; port 8000 serves the backend API.

Use `--foreground` if you want live terminal logs and `Ctrl+C` shutdown instead of background launch. Closing the browser does not stop the background app; it runs until you use `--stop`, log out, or shut down the computer.

Available launcher flags:

```text
--no-browser
--setup-only
--force-install
--foreground
--stop
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
artwork/playlists/
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

The repository is split into a React/Vite client and a FastAPI service. See [the codebase map](architecture.md) for domain ownership and safe change boundaries:

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
- **Windows setup cannot find Python:** download the latest Windows setup again; it checks the Python launcher, PATH and registered installations, reuses Python 3.13 or 3.14, and installs a supported runtime automatically when needed. Python 3.15 can stay installed alongside it.
- **Wrong Python or Node version:** use Python 3.13 and Node 24 LTS. The launcher also accepts the tested adjacent Python 3.14 and Node 25/26 runtimes, but the release reference and CI versions are 3.13 and 24.
- **Migration failed:** stop ANM Player, preserve the complete data root and state file, then run `apps/api/.venv/Scripts/python.exe -m alembic current` from `apps/api`. Do not delete a source root or migration state to force progress.
- **Stale native processes:** close old launcher terminals and stop remaining `uvicorn`, `node`, or `npm` processes before restarting.
- **Docker will not start:** confirm Docker Desktop's Linux engine is running, then rerun `docker compose config` before rebuilding.
- **Provider request failed:** retry later and check `data/logs`. YouTube Music and yt-dlp changes can temporarily break search, streaming, or downloads even when ANM Player itself is unchanged.

## Security and remote access

ANM Player's bearer token is intentionally kept out of browser code, URLs, storage, and built assets. Nginx or the Vite development proxy injects it into same-origin upstream requests. The production API port is not published.

This does not make ANM Player safe to expose directly to a LAN or the internet. Every visitor who reaches the web UI effectively has operator access. Keep `WEB_BIND_HOST=127.0.0.1`; if a reverse proxy uses your own hostname, add that hostname to `API_TRUSTED_HOSTS`. For remote use, add a separately authenticated reverse proxy or a private VPN and restrict it to trusted people. See [SECURITY.md](../SECURITY.md) for vulnerability reporting.

## Provider and legal note

ANM Player depends on YouTube Music, yt-dlp, and third-party lyrics/metadata behavior. Use it only for media you are entitled to access, follow provider terms, and comply with copyright law in your jurisdiction. The maintainers do not grant rights to music or provider content and cannot determine whether a particular download is lawful for you.

Authenticated API documentation is available at <http://127.0.0.1:5173/api/v1/docs> while ANM Player is running.

ANM Player is released under the [MIT License](../LICENSE).
