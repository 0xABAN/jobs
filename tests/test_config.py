import pytest

from jobs.config import banned


@pytest.mark.parametrize(("url", "expected"), [
    ("https://jobs.lever.co/acme/123", True),
    ("https://lever.co/", True),
    ("https://job-boards.greenhouse.io/acme/jobs/1", False),
    ("https://notlever.co/jobs/1", False),
])
def test_bans_lever_and_its_subdomains(url, expected):
    assert banned(url) is expected
