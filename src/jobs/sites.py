"""What a job URL says about its application site."""

from collections.abc import Iterable
from urllib.parse import parse_qs, urlparse

from jobs.config import BANNED_SITES

# Applicant tracking systems that serve many employers' boards from one host, told apart by path.
BOARD_HOSTS = ("greenhouse.io", "ashbyhq.com")


def on_site(url: str, sites: Iterable[str]) -> bool:
    """Return whether ``url`` is on one of ``sites`` or their subdomains."""
    host = urlparse(url).hostname or ""
    return any(host == site or host.endswith("." + site) for site in sites)


def banned(url: str) -> bool:
    """Return whether ``url`` is on one of the ``BANNED_SITES``."""
    return on_site(url, BANNED_SITES)


def ats_board(url: str) -> tuple[str, str] | None:
    """Return the ``BOARD_HOSTS`` entry that ``url`` applies through and the employer's board there.

    The board is "" when the URL hides it, as an embed with only a token does. ``None`` when the
    URL is on none of the ``BOARD_HOSTS``.
    """
    parts = urlparse(url)

    for ats in BOARD_HOSTS:
        if on_site(url, [ats]):
            # job-boards.greenhouse.io/<board>/jobs/<id>, .../embed/job_app?for=<board>, jobs.ashbyhq.com/<org>/<id>
            board = parse_qs(parts.query).get("for", [parts.path.strip("/").split("/")[0]])[0].lower()
            return ats, "" if board == "embed" else board

    return None
