"""
Metadata enrichment services.

Metadata enrichment hooks. YouTube Music browse/download data is the active
metadata source for the app.
"""

from app.services.metadata.base import MetadataProvider, MetadataResult
from app.services.metadata.service import MetadataEnrichmentService

__all__ = [
    "MetadataProvider",
    "MetadataResult",
    "MetadataEnrichmentService",
]
