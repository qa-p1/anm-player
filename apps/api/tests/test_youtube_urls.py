import pytest

from app.core.youtube import youtube_video_id
from app.repositories.music import _download_source_key


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://www.youtube.com/watch?v=abcdefghijk", "abcdefghijk"),
        ("https://music.youtube.com/watch?v=abcdefghijk&list=RD", "abcdefghijk"),
        ("https://youtu.be/abcdefghijk?t=3", "abcdefghijk"),
        ("https://www.youtube.com/shorts/abcdefghijk", "abcdefghijk"),
        ("https://www.youtube.com/embed/abcdefghijk", "abcdefghijk"),
        ("https://www.youtube.com/shorts/", None),
        ("https://www.youtube.com/watch", None),
        ("https://youtube.com.evil.example/watch?v=abcdefghijk", None),
        ("https://example.com/watch?v=abcdefghijk", None),
        ("", None),
        (None, None),
    ],
)
def test_youtube_video_id(url, expected) -> None:
    assert youtube_video_id(url) == expected


def test_bare_ids_are_accepted_only_when_requested() -> None:
    assert youtube_video_id("abcdefghijk") is None
    assert youtube_video_id("abcdefghijk", allow_bare_id=True) == "abcdefghijk"


def test_download_duplicate_key_tolerates_incomplete_short_urls() -> None:
    # Previously raised IndexError and turned the enqueue into a 500.
    assert _download_source_key("https://www.youtube.com/shorts/") == "https://www.youtube.com/shorts/"
    assert _download_source_key("https://youtu.be/abcdefghijk") == _download_source_key(
        "https://www.youtube.com/watch?v=abcdefghijk"
    )
