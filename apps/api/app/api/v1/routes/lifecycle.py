import os
from urllib.error import URLError
from urllib.request import ProxyHandler, Request, build_opener

from fastapi import APIRouter, HTTPException

router = APIRouter()


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
    except (OSError, URLError) as exc:
        raise HTTPException(status_code=503, detail="The launcher could not be reached. Use the launcher's --stop command.") from exc
    return {"status": "shutting_down"}
