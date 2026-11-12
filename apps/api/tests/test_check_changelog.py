import importlib.util
from pathlib import Path

PATH = Path(__file__).resolve().parents[3] / "scripts" / "check_changelog.py"
SPEC = importlib.util.spec_from_file_location("check_changelog", PATH)
assert SPEC and SPEC.loader
check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(check)


def test_only_the_newest_section_must_use_the_popup_format():
    text = "# Changelog\n\n## Unreleased\n\n- **Faster search**: Results come back sooner.\n\n## 1.0.0\n\n- an old free-form entry\n"
    assert check.format_problems(text) == []


def test_entries_without_a_short_title_or_that_run_long_are_rejected():
    text = "## Unreleased\n\n- Fixed things in search-page.tsx\n- **Long**: " + "word " * 60 + "\n"
    problems = check.format_problems(text)
    assert len(problems) == 2
    assert "Short title" in problems[0] and "under 200" in problems[1]


def test_the_repository_changelog_passes():
    assert check.format_problems((PATH.parents[1] / "CHANGELOG.md").read_text(encoding="utf-8")) == []
