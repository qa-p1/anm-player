"""Countries YouTube Music publishes charts for, used for region-aware Home sections."""

import re
from typing import Any

CHART_REGIONS: dict[str, str] = {
    "AE": "United Arab Emirates", "AR": "Argentina", "AT": "Austria", "AU": "Australia",
    "BE": "Belgium", "BO": "Bolivia", "BR": "Brazil", "CA": "Canada", "CH": "Switzerland",
    "CL": "Chile", "CO": "Colombia", "CR": "Costa Rica", "CZ": "Czechia", "DE": "Germany",
    "DK": "Denmark", "DO": "Dominican Republic", "EC": "Ecuador", "EE": "Estonia", "EG": "Egypt",
    "ES": "Spain", "FI": "Finland", "FR": "France", "GB": "United Kingdom", "GT": "Guatemala",
    "HN": "Honduras", "HU": "Hungary", "ID": "Indonesia", "IE": "Ireland", "IL": "Israel",
    "IN": "India", "IS": "Iceland", "IT": "Italy", "JP": "Japan", "KE": "Kenya", "KR": "South Korea",
    "LU": "Luxembourg", "MX": "Mexico", "NG": "Nigeria", "NI": "Nicaragua", "NL": "Netherlands",
    "NO": "Norway", "NZ": "New Zealand", "PA": "Panama", "PE": "Peru", "PL": "Poland",
    "PT": "Portugal", "PY": "Paraguay", "RO": "Romania", "RS": "Serbia", "RU": "Russia",
    "SA": "Saudi Arabia", "SE": "Sweden", "SV": "El Salvador", "TR": "Türkiye", "TZ": "Tanzania",
    "UA": "Ukraine", "UG": "Uganda", "US": "United States", "UY": "Uruguay", "ZA": "South Africa",
    "ZW": "Zimbabwe",
}
DEFAULT_REGION = "US"


def chart_region(code: str | None) -> str:
    """A supported chart country for `code`, falling back to the default."""
    normalized = (code or "").strip().upper()
    return normalized if normalized in CHART_REGIONS else DEFAULT_REGION


def newest_release(releases: list[tuple[Any, str]]) -> Any | None:
    """The release with the latest year in its card subtitle; ties keep page order."""
    best = None
    best_year = -1
    for item, subtitle in releases:
        match = re.search(r"\b(19|20)\d{2}\b", subtitle or "")
        year = int(match.group(0)) if match else 0
        if year > best_year:
            best, best_year = item, year
    return best
