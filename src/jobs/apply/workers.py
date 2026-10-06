"""Worker slots, so several applications run in parallel.

Worker ``n`` owns ``~/.jobs/workers/<n>/``: the directory its Pi agent runs in (outside the
repo, so no AGENTS.md reaches the agent), a copy of Adam's ``jobs`` Chrome profile in
``chrome/``, and ``job``, a lock file naming the URL it is applying to. Holding that lock is
owning the worker, across processes; the operating system releases it if the process dies.
"""

import json
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from jobs.config import CHROME_PROFILE, REPO_ROOT, STATE_DIR
from jobs.lock import locked

WORKERS_DIR = STATE_DIR / "workers"

# Profile files a copy does without: caches, and files that tie a profile to a running Chrome.
NOT_COPIED = shutil.ignore_patterns(
    "Singleton*", "RunningChromeVersion", "DevToolsActivePort", "*Cache*", "Service Worker", "Crashpad"
)


@contextmanager
def worker(url: str, count: int, first: int = 0, *, wait_for_url: bool = False):
    """Wait for a free worker among the ``count`` from number ``first`` on, claim it for ``url``, and yield its directory.

    When another worker is already applying to ``url``, yields ``None``, or with ``wait_for_url``
    waits for that run to end. Dry runs wait, so parallel experiments can repeat the same postings.
    While another worker applies to the same employer through Greenhouse, waits for it too.
    """
    while True:
        for n in range(first, first + count):
            directory = WORKERS_DIR / str(n)
            with locked(directory / "job", wait=False) as job:
                if job is None:
                    continue

                claim = _claim(job, url)
                if claim == "same employer":
                    break  # wait for that run, then try again

                if claim == "duplicate":
                    if wait_for_url:
                        break

                    yield None
                    return

                _prepare(directory)
                yield directory
                return

        time.sleep(5)


def running() -> list[str]:
    """Return the URLs that workers are applying to now."""
    urls = []
    for job in sorted(WORKERS_DIR.glob("*/job")):
        with locked(job, wait=False) as free:
            if free is None:
                urls.append(job.read_text(encoding="utf-8"))

    return urls


def _claim(job, url: str) -> str:
    """Write ``url`` into this worker's job file and return "claimed".

    Returns "duplicate" instead when another worker already has ``url``, and "same employer" when
    another worker is applying to the same employer through Greenhouse (see ``_shares_codes``).
    """
    job.truncate(0)  # forget this worker's previous job

    # Check and claim under one lock, so two workers never take the same URL.
    with locked(WORKERS_DIR / "claims.lock"):
        others = running()
        if url in others:
            return "duplicate"

        if any(_shares_codes(url, other) for other in others):
            return "same employer"

        job.write(url)
        job.flush()
        return "claimed"


def _shares_codes(url: str, other: str) -> bool:
    """Whether applications at both URLs would get Greenhouse security codes that cannot be told apart.

    Greenhouse emails each application its own code, under a subject that names only the employer,
    so two applications to one employer at once can each type the other's code: Tower Research's
    second application was rejected that way (run 20261005-222717-0). A URL that hides its board,
    such as an embed with only a token, could be any employer's. A Greenhouse form on the
    employer's own site, such as stripe.com, goes unrecognized.
    """
    boards = _greenhouse_board(url), _greenhouse_board(other)
    if None in boards:
        return False

    return boards[0] == boards[1] or "" in boards


def _greenhouse_board(url: str) -> str | None:
    """Return the Greenhouse board ``url`` applies through, "" when the URL does not show it, or ``None`` off Greenhouse."""
    parts = urlparse(url)
    if not (parts.hostname or "").endswith("greenhouse.io"):
        return None

    # https://job-boards.greenhouse.io/embed/job_app?for=waymo&token=...
    if board := parse_qs(parts.query).get("for"):
        return board[0].lower()

    # https://job-boards.greenhouse.io/<board>/jobs/<id>, but not https://app.greenhouse.io/embed/job_app?token=...
    first, *_ = parts.path.strip("/").split("/")
    return "" if first in ("", "embed") else first.lower()


def _prepare(directory: Path) -> None:
    """Give a worker the repo's MCP servers and, on first use, a copy of Adam's Chrome profile and its logins.

    Every time, it also turns off Chrome's offer to save passwords in that copy: the "Save
    password?" bubble after a sign-up opens as a second window of the agent's Chrome, and
    CUA then refuses key presses as ambiguous between the two windows.
    """
    mcp = directory / ".pi/mcp.json"
    mcp.parent.mkdir(parents=True, exist_ok=True)
    mcp.unlink(missing_ok=True)
    mcp.symlink_to(REPO_ROOT / ".pi/mcp.json")

    chrome = directory / "chrome"
    if not chrome.exists():
        # Copy aside and rename, so an interrupted copy never passes for a finished one.
        partial = directory / "chrome.partial"
        shutil.rmtree(partial, ignore_errors=True)
        shutil.copytree(CHROME_PROFILE, partial, symlinks=True, ignore=NOT_COPIED)
        partial.rename(chrome)

    # Chrome reads its preferences at launch, and this worker's Chrome is not running yet.
    preferences_path = chrome / "Default/Preferences"
    preferences = json.loads(preferences_path.read_text(encoding="utf-8"))
    preferences["credentials_enable_service"] = False
    preferences.setdefault("profile", {})["password_manager_enabled"] = False
    preferences_path.write_text(json.dumps(preferences), encoding="utf-8")
