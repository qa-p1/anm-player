from contextlib import contextmanager

import pytest
from app.services.ytmusic_service import playback


def test_audio_selection_preserves_quality_preferences_without_video_formats():
    medium_opus = {
        "mimeType": "audio/webm; codecs=opus",
        "bitrate": 120_000,
        "audioQuality": "AUDIO_QUALITY_MEDIUM",
    }
    high_aac = {
        "mimeType": "audio/mp4; codecs=mp4a",
        "bitrate": 200_000,
        "audioQuality": "AUDIO_QUALITY_HIGH",
    }
    video = {"mimeType": "video/mp4", "width": 1920, "bitrate": 9_000_000}
    response = {"streamingData": {"adaptiveFormats": [medium_opus, high_aac, video]}}
    assert playback.select_audio_format(response, quality="low") is medium_opus
    assert playback.select_audio_format(response, quality="high") is high_aac
    assert playback.select_audio_format(response, quality="auto") is high_aac
    assert response["streamingData"]["adaptiveFormats"] == [
        medium_opus,
        high_aac,
        video,
    ]


@pytest.mark.parametrize("reject_at", [None, 1_048_576])
def test_stream_validation_checks_later_spans_and_rejects_a_broken_range(
    monkeypatch, reject_at
):
    ranges = []

    class Opener:
        @contextmanager
        def open(self, request, timeout):
            byte_range = request.get_header("Range")
            ranges.append(byte_range)

            class Response:
                status = 403 if byte_range.startswith(f"bytes={reject_at}-") else 206

                def read(self, length):
                    assert length == 2
                    return b"ok"

            yield Response()

    monkeypatch.setattr(playback, "build_opener", Opener)
    result = playback.validate_stream_spans(
        "https://example.invalid/audio", {}, content_length=4_000_000
    )
    assert result is (reject_at is None)
    assert ranges == (
        ["bytes=0-1", "bytes=1048576-1048577", "bytes=3145728-3145729"]
        if reject_at is None
        else ["bytes=0-1", "bytes=1048576-1048577"]
    )


def test_plain_signature_cipher_preserves_existing_query():
    url = playback.decipher_signature_cipher(
        {
            "signatureCipher": "url=https%3A%2F%2Fexample.invalid%2Fa%3Fx%3D1&sig=abc&sp=sig"
        }
    )
    assert url == "https://example.invalid/a?x=1&sig=abc"
