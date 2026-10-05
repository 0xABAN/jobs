"""Apply to one job: claim a worker, open the job in its Chrome, run a headless Pi agent, and record the result.

Each run leaves ``~/.jobs/runs/<run id>/`` with the prompt, the agent's JSONL
transcript, and ``result.json``, which also times the run's phases for ``jobs
timeline``. The prompt embeds Adam's profile, so the directory is private to his
account. Live runs are also recorded in the tracker, and so is any account an
agent used, in dry runs too.
"""

import json
import subprocess
import time
from dataclasses import asdict
from datetime import date, datetime

from jobs import pi
from jobs.apply.prompt import render_prompt
from jobs.apply.result import Result, parse_result
from jobs.apply.workers import worker
from jobs.chrome import chrome, devtools_port
from jobs.config import STATE_DIR, banned, load_profile
from jobs.tracker import Tracker

RUNS_DIR = STATE_DIR / "runs"


def apply(url: str, *, dry_run: bool, timeout_minutes: float, workers: int, model: str | None = None) -> Result:
    """Apply to the job at ``url`` on one of ``workers`` workers, waiting for a free one, and return how it ended."""
    if banned(url):
        return Result("skipped", "banned_site", "The harness never applies on this site.")

    profile = load_profile()
    tracker = Tracker(profile["tracker"]["sheet_id"])
    stopwatch = Stopwatch()

    with worker(url, workers) as directory:
        stopwatch.lap("worker")
        if directory is None:
            return Result("skipped", "in_progress", "Another worker is applying to this job.")
        if reason := tracker.skip_reason(url):
            return Result("skipped", reason, "The tracker already settles this job.")
        stopwatch.lap("check")

        run_id = f"{datetime.now():%Y%m%d-%H%M%S}-{directory.name}"
        run_dir = RUNS_DIR / run_id

        with chrome(directory / "chrome", url) as chrome_pid:
            stopwatch.lap("chrome")
            run_dir.mkdir(parents=True, mode=0o700)
            prompt = run_dir / "prompt.md"
            prompt.write_text(render_prompt(
                url, dry_run=dry_run, profile=profile, today=date.today(), session=f"apply-{run_id}",
                chrome_pid=chrome_pid, devtools_port=devtools_port(directory / "chrome"),
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
                tracker.record_account(result.account, profile["personal"]["email"])
        finally:
            stopwatch.lap("record")
            record = {"url": url, "dry_run": dry_run, **asdict(result), "phases": stopwatch.laps}
            (run_dir / "result.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

    return result


class Stopwatch:
    """Times the phases of a run in order: ``lap(name)`` ends the phase called ``name``."""

    def __init__(self):
        self.laps: dict[str, float] = {}  # seconds per phase
        self._last = time.monotonic()

    def lap(self, name: str) -> None:
        now = time.monotonic()
        self.laps[name] = round(now - self._last, 1)
        self._last = now
