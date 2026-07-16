from app.services.ytmusic_service.service import _responsive_item


def test_responsive_item_reads_duration_from_fixed_column() -> None:
    item = _responsive_item(
        {
            "flexColumns": [
                {
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": {"runs": [{"text": "Online song"}]}
                    }
                }
            ],
            "fixedColumns": [
                {
                    "musicResponsiveListItemFixedColumnRenderer": {
                        "text": {"runs": [{"text": "3:47"}]}
                    }
                }
            ],
            "navigationEndpoint": {"watchEndpoint": {"videoId": "video-id"}},
        }
    )

    assert item is not None
    assert item.duration_seconds == 227
