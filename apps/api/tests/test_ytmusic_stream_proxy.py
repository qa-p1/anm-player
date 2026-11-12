from app.api.v1.routes import ytmusic
from app.services.ytmusic_service import PlaybackData


class FakeRemoteResponse:
    status = 206
    headers = {"Content-Length": "4", "Content-Range": "bytes 0-3/4"}

    def read1(self, size):
        if getattr(self, "done", False):
            return b""
        self.done = True
        return b"webm"

    def close(self):
        pass


class FakeOpener:
    def open(self, request, timeout):
        assert request.full_url == "https://example.com/audio"
        assert request.headers["Range"] == "bytes=0-3"
        return FakeRemoteResponse()


def test_uncached_stream_proxy_builds_url_request(monkeypatch) -> None:
    monkeypatch.setattr(ytmusic, "build_opener", lambda: FakeOpener())
    playback = PlaybackData(
        video_id="video",
        title="Song",
        author="Artist",
        stream_url="https://example.com/audio",
        expires_in_seconds=60,
        client_name="test",
        format={"mimeType": 'audio/webm; codecs="opus"'},
    )

    response = ytmusic._proxy_playback_stream(playback, "bytes=0-3")

    assert response.status_code == 206
    assert response.media_type == "audio/webm"


def test_expired_stream_link_is_refreshed_once(monkeypatch) -> None:
    from types import SimpleNamespace
    from urllib.error import HTTPError

    def playback(url: str) -> PlaybackData:
        return PlaybackData(video_id="video", title="Song", author="Artist", stream_url=url, expires_in_seconds=60, client_name="test", format={"mimeType": "audio/webm"})

    resolved = iter([playback("https://example.com/expired"), playback("https://example.com/fresh")])
    monkeypatch.setattr(ytmusic, "_resolve_source", lambda session, video_id: SimpleNamespace(path=None, playback=next(resolved), kind="streaming"))
    invalidated: list[str] = []
    monkeypatch.setattr(ytmusic.ytmusic_service, "invalidate_playback", invalidated.append)

    class Opener:
        def open(self, request, timeout):
            if request.full_url.endswith("expired"):
                raise HTTPError(request.full_url, 403, "Forbidden", {}, None)
            return FakeRemoteResponse()

    monkeypatch.setattr(ytmusic, "build_opener", lambda: Opener())
    response = ytmusic.stream("video", None, "bytes=0-3")
    assert response.status_code == 206
    assert invalidated == ["video"]


def test_first_play_reads_the_cache_download_as_it_arrives(monkeypatch, tmp_path) -> None:
    import asyncio
    import threading

    from app.services.stream_cache import ProgressiveDownload

    data = bytes(range(256)) * 64
    temp, final = tmp_path / "song.webm.part", tmp_path / "song.webm"
    progress = ProgressiveDownload("audio/webm")
    monkeypatch.setattr(ytmusic.StreamCacheService, "progressive_download", staticmethod(lambda video_id, quality: progress))

    def download() -> None:
        with temp.open("wb") as output:
            progress.started(temp, len(data))
            for offset in range(0, len(data), 1000):
                output.write(data[offset:offset + 1000])
                output.flush()
                progress.advanced(min(len(data), offset + 1000))
        temp.replace(final)
        progress.finish(final)

    playback = PlaybackData(video_id="video", title="Song", author="Artist", stream_url="https://example.com/audio", expires_in_seconds=60, client_name="test", format={"mimeType": "audio/webm"})
    threading.Thread(target=download).start()
    response = ytmusic._progressive_response(playback, "bytes=100-", "high")
    assert response is not None
    assert response.status_code == 206
    assert response.headers["Content-Range"] == f"bytes 100-{len(data) - 1}/{len(data)}"

    async def body() -> bytes:
        return b"".join([chunk async for chunk in response.body_iterator])

    assert asyncio.run(body()) == data[100:]
    assert ytmusic._byte_span("bytes=-10", 50) == (40, 49)
    assert ytmusic._byte_span("bytes=60-", 50) is None
