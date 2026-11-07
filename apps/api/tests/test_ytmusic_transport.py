import asyncio
import json
from contextlib import contextmanager

import httpx
import pytest
from app.services.ytmusic_service import transport
from app.services.ytmusic_service.transport import InnerTubeSession


def configured_session(monkeypatch, html: str):
    requests = []
    session = InnerTubeSession(gl="IN", hl="en-IN")

    class Opener:
        @contextmanager
        def open(self, request, timeout):
            requests.append(
                (
                    request.method,
                    request.full_url,
                    dict(request.header_items()),
                    request.data,
                )
            )

            class Response:
                def read(self):
                    return html.encode() if request.method == "GET" else b"{}"

            yield Response()

    session._opener = Opener()
    original_client = httpx.AsyncClient

    def handle(request):
        requests.append(
            (request.method, str(request.url), dict(request.headers), request.content)
        )
        return httpx.Response(200, text=html if request.method == "GET" else "{}")

    monkeypatch.setattr(
        transport.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(handle), **kwargs
        ),
    )
    return session, requests


@pytest.mark.parametrize("asynchronous", [False, True])
def test_search_transport_uses_one_provider_config_and_preserves_locale(
    monkeypatch, asynchronous
):
    html = (
        "ytcfg.set("
        + json.dumps(
            {
                "INNERTUBE_API_KEY": "provider-key",
                "INNERTUBE_CONTEXT_CLIENT_VERSION": "provider-version",
                "INNERTUBE_CONTEXT": {
                    "client": {
                        "clientName": "WEB_REMIX",
                        "visitorData": "visitor",
                        "gl": "US",
                    }
                },
            }
        )
        + ");"
    )
    session, requests = configured_session(monkeypatch, html)

    if asynchronous:
        asyncio.run(session.search_async("song", params="filter", continuation="next"))
        asyncio.run(session.search_async("song"))
    else:
        session.search("song", params="filter", continuation="next")
        session.search("song")

    assert [request[0] for request in requests] == ["GET", "POST", "POST"]
    _, url, headers, payload = requests[1]
    assert "key=provider-key" in url and "continuation=next" in url
    body = json.loads(payload)
    assert body["query"] == "song" and body["params"] == "filter"
    assert body["context"]["client"]["gl"] == "IN"
    assert body["context"]["client"]["hl"] == "en-IN"
    headers = {key.lower(): value for key, value in headers.items()}
    assert headers["x-youtube-client-version"] == "provider-version"
    assert headers["x-goog-visitor-id"] == "visitor"
    assert headers["origin"] == "https://music.youtube.com"

    context = session.context(session.web_remix_client())
    context["client"]["gl"] = "changed"
    assert session.context(session.web_remix_client())["client"]["gl"] == "IN"


@pytest.mark.parametrize("asynchronous", [False, True])
def test_provider_version_fallback_is_identical_for_sync_and_async(
    monkeypatch, asynchronous
):
    session, _ = configured_session(
        monkeypatch,
        '<script>"INNERTUBE_CONTEXT_CLIENT_VERSION":"fallback-version"</script>',
    )
    config = (
        asyncio.run(session.web_remix_client_async())
        if asynchronous
        else session.web_remix_client()
    )
    assert config.client_version == "fallback-version"


def test_cancelling_config_fetch_does_not_cache_a_fallback(monkeypatch):
    session = InnerTubeSession()
    original_client = httpx.AsyncClient

    async def cancelled(_request):
        raise asyncio.CancelledError

    monkeypatch.setattr(
        transport.httpx,
        "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(cancelled), **kwargs
        ),
    )
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(session.web_remix_client_async())
    assert session._web_remix_client is None


def test_pure_provider_import_does_not_initialize_runtime_clients():
    import subprocess
    import sys
    from pathlib import Path

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import app.services.ytmusic_service.playback; from app.services import CatalogService; import sys; assert 'app.services.ytmusic_service.service' not in sys.modules",
        ],
        capture_output=True,
        text=True,
        cwd=Path(__file__).resolve().parents[1],
        check=False,
    )
    assert result.returncode == 0, result.stderr
