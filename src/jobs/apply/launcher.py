"""Apply to one job: claim a worker, open the job in its Chrome, run a headless Pi agent, and record the result.

Each run leaves ``~/.jobs/runs/<run id>/`` with the prompt, the agent's JSONL
transcript, and ``result.json``. The prompt embeds Adam's profile, so the
directory is private to his account. Live runs are also recorded in the tracker.
"""

import json
import os
import re
import signal
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import date, datetime
from pathlib import Path

from jobs.apply.chrome import chrome
from jobs.apply.prompt import render_prompt
from jobs.apply.workers import worker
from jobs.config import STATE_DIR, load_profile
from jobs.tracker import Tracker

RUNS_DIR = STATE_DIR / "runs"

# Extension tools an apply agent must not use: they spawn agents or message other Pi sessions.
EXCLUDED_TOOLS = "Agent,SubagentWorkflow,get_subagent_result,steer_subagent,intercom,create_goal,todo"

# The last ```json block of the agent's final message holds its result.
RESULT_BLOCK = re.compile(r"```json\s*(.*?)```", re.DOTALL)


@dataclass(frozen=True)
class Result:
    """How one application ended; ``prompt.md`` defines the values the agent reports."""

    status: str  # "applied", "dry_run", "failed", or "skipped" (the agent never ran)
    reason: str | None  # why it failed or was skipped; None otherwise
    explanation: str
    company: str | None = None
    role: str | None = None
    salary: str | None = None  # the posted pay range, as written


def apply(url: str, *, dry_run: bool, timeout_minutes: float, workers: int, model: str | None = None) -> Result:
    """Apply to the job at ``url`` on one of ``workers`` workers, waiting for a free one, and return how it ended."""
    profile = load_profile()
    tracker = Tracker(profile["tracker"]["sheet_id"])

    with worker(url, workers) as directory:
        if directory is None:
            return Result("skipped", "in_progress", "Another worker is applying to this job.")
        if reason := tracker.skip_reason(url):
            return Result("skipped", reason, "The tracker already settles this job.")

        run_id = f"{datetime.now():%Y%m%d-%H%M%S}-{directory.name}"
        run_dir = RUNS_DIR / run_id
        started = time.monotonic()

        with chrome(directory / "chrome", url) as chrome_pid:
            run_dir.mkdir(parents=True, mode=0o700)
            prompt = render_prompt(url, dry_run=dry_run, profile=profile, today=date.today(),
                                   session=f"apply-{run_id}", chrome_pid=chrome_pid)
            result = _run_agent(prompt, run_dir, directory, timeout_minutes, model)

        record = {"url": url, "dry_run": dry_run, "seconds": round(time.monotonic() - started), **asdict(result)}
        (run_dir / "result.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")

        # Record while still holding the worker, so no other worker starts this URL in between.
        if not dry_run:
            tracker.record(url, result, run_id)

    return result


def parse_result(final_message: str) -> Result:
    """Return the result the agent ended with, or a ``no_result`` failure when it is missing or malformed."""
    try:
        result = Result(**json.loads(RESULT_BLOCK.findall(final_message)[-1]))
    except (IndexError, ValueError, TypeError):
        result = None

    succeeded = result and result.status in ("applied", "dry_run") and result.reason is None
    failed = result and result.status == "failed" and isinstance(result.reason, str) and result.reason
    if not (succeeded or failed):
        return Result("failed", "no_result", f"The agent ended without a valid result: {final_message[-300:]!r}")

    return result


def _run_agent(prompt: str, run_dir: Path, worker_dir: Path, timeout_minutes: float, model: str | None) -> Result:
    prompt_path = run_dir / "prompt.md"
    transcript_path = run_dir / "transcript.jsonl"
    prompt_path.write_text(prompt, encoding="utf-8")

    command = [
        "pi", "--mode", "json", "--no-session",
        "--no-context-files",  # the prompt is the agent's only instructions
        "--approve",  # load the worker's .pi/mcp.json without a trust prompt
        "--exclude-tools", EXCLUDED_TOOLS,
        *(["--model", model] if model else []),
        f"@{prompt_path}",
    ]

    with transcript_path.open("w", encoding="utf-8") as transcript, (run_dir / "stderr.log").open("w") as stderr:
        # A session of its own, so a timeout can kill Pi together with its MCP servers.
        agent = subprocess.Popen(command, cwd=worker_dir, stdout=transcript, stderr=stderr, start_new_session=True)
        try:
            agent.wait(timeout=timeout_minutes * 60)
        except subprocess.TimeoutExpired:
            os.killpg(agent.pid, signal.SIGKILL)
            agent.wait()
            return Result("failed", "timeout", f"The agent did not finish within {timeout_minutes:g} minutes.")

    return parse_result(_final_message(transcript_path))


def _final_message(transcript: Path) -> str:
    """Return the text of the agent's last message in a Pi JSON-mode transcript, or its error."""
    final = ""

    # Pi frames records with LF only; splitlines() would also split on Unicode separators inside strings.
    for line in transcript.read_text(encoding="utf-8").split("\n"):
        if not line.strip():
            continue

        event = json.loads(line)
        if event.get("type") == "message_end" and event["message"]["role"] == "assistant":
            message = event["message"]
            text = "".join(block["text"] for block in message["content"] if block["type"] == "text")
            final = text or message.get("errorMessage", "")

    return final
