import io
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.ytmusic_service import PlaybackData
from app.workers.downloads import worker as worker_module


class Response(io.BytesIO):
    def __init__(self, body: bytes, *, status=200, headers=None):
        super().__init__(body)
        self.status = status
        self.headers = headers or {}


def playback(*, length=None):
    return PlaybackData(
        video_id="test-video",
        title="Resolved song",
        author="Resolved artist",
        stream_url="https://example.com/audio",
        expires_in_seconds=60,
        client_name="test",
        format={"mimeType": "audio/webm", **({"contentLength": str(length)} if length else {})},
        request_headers={"User-Agent": "test-client"},
        video_details={"lengthSeconds": "123"},
    )


@pytest.fixture
def worker(monkeypatch):
    instance = worker_module.DownloadWorker()
    monkeypatch.setattr(instance, "_update_progress", lambda *args: None)
    monkeypatch.setattr(worker_module.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(worker_module, "storage_coordinator", SimpleNamespace(cancel_work=threading.Event()))
    return instance


def opener(monkeypatch, responses):
    requests = []
    remaining = iter(responses)

    def open_request(request, timeout):
        requests.append(request)
        return next(remaining)

    monkeypatch.setattr(worker_module, "build_opener", lambda: SimpleNamespace(open=open_request))
    return requests


def test_download_prefers_resolved_playback_stream(worker, tmp_path, monkeypatch):
    expected = ({"title": "Song"}, tmp_path / "song.mp3")
    calls = []

    def direct(*args):
        calls.append(args)
        return expected

    monkeypatch.setattr(worker, "_download_media_direct", direct)
    monkeypatch.setattr(worker_module, "YoutubeDL", lambda options: pytest.fail("yt-dlp must remain a fallback"))
    assert worker._download_media(1, "https://youtube.com/watch?v=test-video", "mp3", tmp_path) == expected
    assert calls == [(1, "test-video", "mp3", tmp_path)]


def test_download_falls_back_to_ytdlp_when_resolved_stream_fails(worker, tmp_path, monkeypatch):
    def direct(*args):
        raise OSError("HTTP 403")

    class YoutubeDL:
        def __init__(self, options):
            assert options["postprocessors"][0]["key"] == "FFmpegExtractAudio"

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def extract_info(self, url, download):
            assert download
            (tmp_path / "song.mp3").write_bytes(b"converted audio")
            return {"title": "Fallback song"}

    monkeypatch.setattr(worker, "_download_media_direct", direct)
    monkeypatch.setattr(worker_module, "YoutubeDL", YoutubeDL)
    info, target = worker._download_media(1, "https://youtube.com/watch?v=test-video", "mp3", tmp_path)
    assert info["title"] == "Fallback song"
    assert target.read_bytes() == b"converted audio"


def test_cancelled_download_does_not_start_ytdlp_fallback(worker, tmp_path, monkeypatch):
    def direct(*args):
        raise RuntimeError("Download cancelled")

    monkeypatch.setattr(worker, "_download_media_direct", direct)
    monkeypatch.setattr(worker_module, "YoutubeDL", lambda options: pytest.fail("Cancellation must stop the download"))
    with pytest.raises(RuntimeError, match="cancelled"):
        worker._download_media(1, "https://youtube.com/watch?v=test-video", "mp3", tmp_path)


def test_ranged_retry_discards_partial_bytes_before_retrying(worker, tmp_path, monkeypatch):
    headers = {"Content-Range": "bytes 0-3/4"}
    requests = opener(monkeypatch, [Response(b"ab", status=206, headers=headers), Response(b"abcd", status=206, headers=headers)])
    target = tmp_path / "audio.webm"
    assert worker._download_playback_stream(1, playback(length=4), target) == (4, 4)
    assert target.read_bytes() == b"abcd"
    assert [request.get_header("Range") for request in requests] == ["bytes=0-3", "bytes=0-3"]


def test_ignored_range_restarts_sequentially_without_appending(worker, tmp_path, monkeypatch):
    requests = opener(monkeypatch, [
        Response(b"abcd", status=206, headers={"Content-Range": "bytes 0-3/8"}),
        Response(b"abcdefgh", headers={"Content-Length": "8"}),
        Response(b"abcdefgh", headers={"Content-Length": "8"}),
    ])
    target = tmp_path / "audio.webm"
    assert worker._download_playback_stream(1, playback(length=8), target) == (8, 8)
    assert target.read_bytes() == b"abcdefgh"
    assert [request.get_header("Range") for request in requests] == ["bytes=0-7", "bytes=4-7", None]


def test_wrong_byte_range_is_rejected(worker, tmp_path, monkeypatch):
    requests = opener(monkeypatch, [
        Response(b"bcd", status=206, headers={"Content-Range": "bytes 1-3/4"}) for _ in range(3)
    ])
    with pytest.raises(RuntimeError, match="unexpected byte range"):
        worker._download_playback_stream(1, playback(length=4), tmp_path / "audio.webm")
    assert len(requests) == 3


def test_truncated_sequential_stream_is_rejected(worker, tmp_path, monkeypatch):
    opener(monkeypatch, [Response(b"abc", headers={"Content-Length": "8"})])
    with pytest.raises(RuntimeError, match="range was complete"):
        worker._download_playback_stream(1, playback(), tmp_path / "audio.webm")


def test_cancellation_during_copy_is_not_retried(worker, tmp_path, monkeypatch):
    requests = opener(monkeypatch, [Response(b"abcd", status=206, headers={"Content-Range": "bytes 0-3/4"})])

    def cancelled(*args):
        raise RuntimeError("Download cancelled")

    monkeypatch.setattr(worker, "_update_progress", cancelled)
    with pytest.raises(RuntimeError, match="cancelled"):
        worker._download_playback_stream(1, playback(length=4), tmp_path / "audio.webm")
    assert len(requests) == 1


@pytest.mark.parametrize("conversion_succeeds", [True, False])
def test_conversion_preserves_metadata_and_cleans_up_partial_files(worker, tmp_path, monkeypatch, conversion_succeeds):
    monkeypatch.setattr(worker_module.ytmusic_service, "playback", lambda *args, **kwargs: playback())
    monkeypatch.setattr(worker_module.shutil, "which", lambda executable: "/usr/bin/ffmpeg")

    def stream(job_id, resolved, target):
        target.write_bytes(b"source audio")
        return 12, 12

    def convert(command, **kwargs):
        Path(command[-1]).write_bytes(b"converted audio")
        return SimpleNamespace(returncode=0 if conversion_succeeds else 1, stderr="conversion failed")

    monkeypatch.setattr(worker, "_download_playback_stream", stream)
    monkeypatch.setattr(worker_module.subprocess, "run", convert)
    if conversion_succeeds:
        info, target = worker._download_media_direct(1, "test-video", "mp3", tmp_path)
        assert info["title"] == "Resolved song" and info["artist"] == "Resolved artist" and info["duration"] == 123
        assert list(tmp_path.iterdir()) == [target]
    else:
        with pytest.raises(RuntimeError, match="conversion failed"):
            worker._download_media_direct(1, "test-video", "mp3", tmp_path)
        assert list(tmp_path.iterdir()) == []
