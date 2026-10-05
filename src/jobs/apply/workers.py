"""Worker slots, so several applications run in parallel.

Worker ``n`` owns ``~/.jobs/workers/<n>/``: the directory its Pi agent runs in (outside the
repo, so no AGENTS.md reaches the agent), a copy of Adam's ``jobs`` Chrome profile in
``chrome/``, and ``job``, a lock file naming the URL it is applying to. Holding that lock is
owning the worker, across processes; the operating system releases it if the process dies.
"""

import shutil
import time
from contextlib import contextmanager
from pathlib import Path

from jobs.config import CHROME_PROFILE, REPO_ROOT, STATE_DIR
from jobs.lock import locked

WORKERS_DIR = STATE_DIR / "workers"

# Profile files a copy does without: caches, and files that tie a profile to a running Chrome.
NOT_COPIED = shutil.ignore_patterns(
    "Singleton*", "RunningChromeVersion", "DevToolsActivePort", "*Cache*", "Service Worker", "Crashpad"
)


@contextmanager
def worker(url: str, count: int):
    """Wait for a free worker among ``count``, claim it for ``url``, and yield its directory.

    Yields ``None`` instead when another worker is already applying to ``url``.
    """
    while True:
        for n in range(count):
            directory = WORKERS_DIR / str(n)
            with locked(directory / "job", wait=False) as job:
                if job is None:
                    continue

                if not _claim(job, url):
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


def _claim(job, url: str) -> bool:
    """Write ``url`` into this worker's job file, unless another worker already has it."""
    job.truncate(0)  # forget this worker's previous job

    # Check and claim under one lock, so two workers never take the same URL.
    with locked(WORKERS_DIR / "claims.lock"):
        if url in running():
            return False

        job.write(url)
        job.flush()
        return True


def _prepare(directory: Path) -> None:
    """Give a worker the repo's MCP servers and, on first use, a copy of Adam's Chrome profile and its logins."""
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
