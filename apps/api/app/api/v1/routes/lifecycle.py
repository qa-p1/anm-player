import os
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import APIRouter, Depends, HTTPException, Request as ApiRequest
from urllib.parse import urlparse

router = APIRouter()


def require_update_origin(request: ApiRequest) -> None:
    origin = request.headers.get("origin")
    if origin is None:
        return  # Authenticated command-line clients do not send browser origins.
    try:
        parsed = urlparse(origin)
        valid = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"} and parsed.port == int(os.environ.get("ANM_WEB_PORT", "5173"))
    except ValueError:
        valid = False
    if not valid:
        raise HTTPException(status_code=403, detail="Updates can only be requested from this app's local window.")


@router.post("/shutdown", status_code=202, summary="Shut down the native app and both servers")
def shutdown() -> dict[str, str]:
    port = os.environ.get("ANM_LAUNCHER_CONTROL_PORT", "")
    token = os.environ.get("ANM_LAUNCHER_CONTROL_TOKEN", "")
    if not port.isdecimal() or not 1 <= int(port) <= 65535 or not token:
        raise HTTPException(status_code=409, detail="Close app is available when started with the native launcher.")
    request = Request(
        f"http://127.0.0.1:{port}/stop",
        headers={"Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with build_opener(ProxyHandler({})).open(request, timeout=3) as response:
            if response.status != 200:
                raise HTTPException(status_code=503, detail="The launcher could not shut down the app. Try again.")
    except HTTPError as exc:
        code = exc.code
        exc.close()
        if code == 409:
            raise HTTPException(status_code=409, detail="Wait for the app update to finish before closing.") from exc
        raise HTTPException(status_code=503, detail="The launcher could not shut down the app. Try again.") from exc
    except (OSError, URLError) as exc:
        raise HTTPException(status_code=503, detail="The launcher could not be reached. Use the launcher's --stop command.") from exc
    return {"status": "shutting_down"}


def update_request(action: str, *, post: bool = False) -> dict:
    """Only the authenticated loopback launcher can install native updates."""
    import json

    from app.core.config import settings

    port = os.environ.get("ANM_LAUNCHER_CONTROL_PORT", "")
    token = os.environ.get("ANM_LAUNCHER_CONTROL_TOKEN", "")
    if not port.isdecimal() or not 1 <= int(port) <= 65535 or not token:
        if post:
            raise HTTPException(status_code=409, detail="Use Docker Compose to update this installation, or start the desktop app with its launcher.")
        return {"supported": False, "state": "unsupported", "current_version": settings.app_version, "message": "Docker installations update with Docker Compose. Desktop installations use the ANM Player launcher."}
    request = Request(f"http://127.0.0.1:{port}/updates/{action}", headers={"Authorization": f"Bearer {token}"}, method="POST" if post else "GET")
    try:
        with build_opener(ProxyHandler({})).open(request, timeout=5) as response:
            return json.loads(response.read(1024 * 1024))
    except HTTPError as exc:
        exc.close()
        raise HTTPException(status_code=409, detail="An update is already running, or another check is needed. Refresh the update status and try again.") from exc
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="The launcher could not be reached. Restart ANM Player with its launch shortcut.") from exc


@router.get("/updates", summary="Native update status")
def update_status() -> dict:
    return update_request("status")


@router.post("/updates/check", status_code=202, summary="Check GitHub for an app update", dependencies=[Depends(require_update_origin)])
def check_updates() -> dict:
    return update_request("check", post=True)


@router.post("/updates/install", status_code=202, summary="Install the checked update and restart", dependencies=[Depends(require_update_origin)])
def install_update() -> dict:
    from app.storage.state import storage_state_store

    if storage_state_store.read().get("migration"):
        raise HTTPException(status_code=409, detail="Finish the storage move before installing an update.")
    return update_request("install", post=True)
