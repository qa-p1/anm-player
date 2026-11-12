import os
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import APIRouter, Depends, HTTPException, Request as ApiRequest
from pydantic import BaseModel, Field
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


class UninstallRequest(BaseModel):
    keep_data: bool
    confirmation: str = Field(max_length=32)


UNINSTALL_CONFIRMATIONS = {True: "UNINSTALL ANM PLAYER", False: "DELETE ANM PLAYER"}


def installed_launcher() -> tuple[str, str] | None:
    """The launcher control endpoint, when this is an installed desktop copy."""
    port = os.environ.get("ANM_LAUNCHER_CONTROL_PORT", "")
    token = os.environ.get("ANM_LAUNCHER_CONTROL_TOKEN", "")
    if not os.environ.get("ANM_INSTALL_ROOT") or not port.isdecimal() or not 1 <= int(port) <= 65535 or not token:
        return None
    return port, token


@router.get("/uninstall", summary="Whether this copy can uninstall itself")
def uninstall_status() -> dict[str, object]:
    from app.storage.paths import storage_manager

    return {"supported": installed_launcher() is not None, "data_root": str(storage_manager.paths.root)}


@router.post("/uninstall", status_code=202, summary="Remove the desktop app, optionally keeping its data", dependencies=[Depends(require_update_origin)])
def uninstall(request: UninstallRequest) -> dict[str, str]:
    import json

    from app.storage.state import storage_state_store

    if request.confirmation != UNINSTALL_CONFIRMATIONS[request.keep_data]:
        raise HTTPException(status_code=422, detail=f"Type {UNINSTALL_CONFIRMATIONS[request.keep_data]} exactly to confirm")
    launcher = installed_launcher()
    if launcher is None:
        raise HTTPException(status_code=409, detail="Only the installed desktop app can uninstall itself. Delete this folder to remove a developer copy.")
    if storage_state_store.read().get("migration"):
        raise HTTPException(status_code=409, detail="Finish the storage operation before uninstalling.")
    port, token = launcher
    control = Request(
        f"http://127.0.0.1:{port}/uninstall",
        data=json.dumps({"keep_data": request.keep_data}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with build_opener(ProxyHandler({})).open(control, timeout=3):
            pass
    except HTTPError as exc:
        code = exc.code
        exc.close()
        detail = "Wait for the app update to finish before uninstalling." if code == 409 else "The launcher could not start the uninstall. Try again."
        raise HTTPException(status_code=409 if code == 409 else 503, detail=detail) from exc
    except (OSError, URLError) as exc:
        raise HTTPException(status_code=503, detail="The launcher could not be reached. Restart ANM Player and try again.") from exc
    return {"status": "uninstalling"}


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
