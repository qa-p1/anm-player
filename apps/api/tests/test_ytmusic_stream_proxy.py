from app.api.v1.routes import ytmusic
from app.services.ytmusic_service import PlaybackData


class FakeRemoteResponse:
    status = 206
    headers = {"Content-Length": "4", "Content-Range": "bytes 0-3/4"}

    def read(self, size):
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
