import asyncio

import pytest

from app.services.artwork_cache import ArtworkCacheService, Image


@pytest.mark.skipif(Image is None, reason="Pillow is optional")
def test_each_artwork_size_is_generated_from_the_original(tmp_path) -> None:
    source = tmp_path / "source.jpg"
    Image.new("RGB", (1200, 1200), "red").save(source)
    service = ArtworkCacheService(tmp_path / "cache")

    asyncio.run(service._create_sizes(source, "https://i.ytimg.com/image.jpg"))

    with Image.open(service.get_cache_path("https://i.ytimg.com/image.jpg", "thumb")) as thumb:
        assert thumb.width == 150
    with Image.open(service.get_cache_path("https://i.ytimg.com/image.jpg", "large")) as large:
        assert large.width == 1000
