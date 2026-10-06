"""Apply to one job: claim a worker, open the job in its Chrome, run a headless Pi agent, and record the result.

Each run leaves ``~/.jobs/runs/<run id>/`` with the prompt, the agent's JSONL
transcript, and ``result.json``, which also times the run's phases for ``jobs
timeline``. The prompt embeds Adam's profile, so the directory is private to his
account. After ``LOGS_KEPT_HOURS`` only ``result.json`` remains. Live runs are also
recorded in the tracker, and so is any account an agent used, in dry runs too.
"""

import contextlib
import json
import subprocess
import time
from dataclasses import asdict
from datetime import date, datetime
from pathlib import Path

from jobs import pi
from jobs.apply.prompt import render_prompt
from jobs.apply.result import Result, parse_result
from jobs.apply.workers import worker
from jobs.chrome import chrome, devtools_port
from jobs.config import REPO_ROOT, STATE_DIR, banned, email_for, load_profile
from jobs.tracker import Tracker

RUNS_DIR = STATE_DIR / "runs"

# Transcripts reach about 100 MB per run, mostly raw CUA results, and prompts hold Adam's
# password, so each run's logs except result.json are deleted after this long.
LOGS_KEPT_HOURS = 3

# Pinned, so a Playwright release cannot change the agent's tools between runs.
PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83"


def apply(url: str, *, dry_run: bool, timeout_minutes: float, workers: int, first_worker: int = 0,
          model: str = pi.MODEL) -> Result:
    """Apply to the job at ``url`` on one of ``workers`` workers from ``first_worker`` on, waiting for a free one, and return how it ended."""
    if banned(url):
        return Result("skipped", "banned_site", "The harness never applies on this site.")

    prune_logs()

    profile = load_profile()
    tracker = Tracker(profile["tracker"]["sheet_id"])
    stopwatch = Stopwatch()

    with worker(url, workers, first_worker, wait_for_url=dry_run) as directory:
        stopwatch.lap("worker")
        if directory is None:
            return Result("skipped", "in_progress", "Another worker is applying to this job.")
        if reason := tracker.skip_reason(url):
            return Result("skipped", reason, "The tracker already settles this job.")
        earlier_applications = tracker.earlier_applications(url)
        stopwatch.lap("check")

        run_id = f"{datetime.now():%Y%m%d-%H%M%S}-{directory.name}"
        run_dir = RUNS_DIR / run_id

        with chrome(directory / "chrome", url) as chrome_pid:
            stopwatch.lap("chrome")
            connect_playwright(directory, devtools_port(directory / "chrome"))
            run_dir.mkdir(parents=True, mode=0o700)
            prompt = run_dir / "prompt.md"
            prompt.write_text(render_prompt(
                url, dry_run=dry_run, profile=profile, today=date.today(), session=f"apply-{run_id}",
                chrome_pid=chrome_pid, devtools_port=devtools_port(directory / "chrome"),
                earlier_applications=earlier_applications,
            ), encoding="utf-8")
            try:
                result = parse_result(pi.run(prompt, cwd=directory, log_dir=run_dir,
                                             timeout_minutes=timeout_minutes, model=model))
            except subprocess.TimeoutExpired:
                result = Result("failed", "timeout", f"The agent did not finish within {timeout_minutes:g} minutes.")
            stopwatch.lap("agent")
        stopwatch.lap("quit")

        try:
            # Record while still holding the worker, so no other worker starts this URL in between.
            if not dry_run:
                tracker.record(url, result, run_id)

            # Dry runs sign in and create accounts for real, so their accounts are recorded too.
            if result.account:
                tracker.record_account(result.account, email_for(profile, result.company))
        finally:
            stopwatch.lap("record")
            record = {"url": url, "dry_run": dry_run, **asdict(result), "phases": stopwatch.laps}
            (run_dir / "result.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    return result


def connect_playwright(directory: Path, port: int) -> None:
    """Give the worker's agent Playwright, attached to this run's Chrome, in place of cua-driver.

    The DevTools port changes with every Chrome launch, so each run writes the worker's MCP
    config afresh from the repo's, which stays the shared source for the other servers.
    """
    config = json.loads((REPO_ROOT / ".pi/mcp.json").read_text(encoding="utf-8"))
    servers = config["mcpServers"]
    del servers["cua-driver"]
    servers["playwright"] = {
        "command": "npx",
        "args": ["-y", PLAYWRIGHT_MCP, "--cdp-endpoint", f"http://127.0.0.1:{port}", "--snapshot-mode", "none"],
        "exposure": "codemode",
        "description": "Drive the job page in Adam's background jobs Chrome",
    }

    path = directory / ".pi/mcp.json"
    path.unlink(missing_ok=True)  # a symlink to the repo's config until now
    path.write_text(json.dumps(config, indent=2), encoding="utf-8")


def prune_logs() -> None:
    """Delete every file but ``result.json`` from run directories, once untouched for ``LOGS_KEPT_HOURS``.

    A running agent writes its transcript continuously, so a live run is never old enough.
    """
    cutoff = time.time() - LOGS_KEPT_HOURS * 3600

    for log in RUNS_DIR.glob("*/*"):
        # Parallel runs prune too, so another one may delete a file first.
        with contextlib.suppress(FileNotFoundError):
            if log.name != "result.json" and log.stat().st_mtime < cutoff:
                log.unlink()


class Stopwatch:
    """Times the phases of a run in order: ``lap(name)`` ends the phase called ``name``."""

    def __init__(self):
        self.laps: dict[str, float] = {}  # seconds per phase
        self._last = time.monotonic()

    def lap(self, name: str) -> None:
        now = time.monotonic()
        self.laps[name] = round(now - self._last, 1)
        self._last = now
