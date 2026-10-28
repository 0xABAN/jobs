"""Run a headless Pi agent on a prompt file and read its final message."""

import json
import os
import signal
import subprocess
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import IO

# The only extensions an apply agent needs: MCP servers, codemode, and the Claude provider. Adam's
# other global extensions would add seconds to every start, and tools a headless agent must not have.
EXTENSIONS = ["builtin:mcp", "builtin:codemode", str(Path.home() / ".pi/agent/npm/node_modules/pi-claude-bridge")]

# The only skill the apply prompt uses, for required essays.
SKILLS = [str(Path.home() / ".pi/agent/skills/write")]

# The Claude provider's tool that hands work to a Claude Code agent; a headless agent must not spawn agents.
# Playwright tools that run Playwright code, close the job's tab, or change the browser are not the agent's to use.
# It keeps browser_evaluate, which runs the prompt's CAPTCHA scripts in the page.
# Agents only read Gmail, and their token is read-only; its tools that send, delete, or change mail are excluded too.
EXCLUDED_TOOLS = ",".join(["AskClaude"] + [f"mcp__playwright__browser_{name}" for name in (
    "run_code_unsafe", "close", "resize", "emulate_media", "network_requests",
    "network_request", "console_messages")] + [f"mcp__gmail__{name}" for name in (
    "send_email", "draft_email", "update_draft", "send_draft", "delete_draft", "reply_all", "delete_email",
    "batch_delete_emails", "modify_email", "batch_modify_emails", "modify_thread", "report_phishing",
    "batch_report_phishing", "create_label", "update_label", "delete_label", "get_or_create_label", "create_filter",
    "create_filter_from_template", "delete_filter", "download_attachment", "download_email")])

# Apply agents' model and thinking level, fixed so Adam's interactive Pi defaults don't change them.
MODEL = "openai-codex/gpt-6.1-sol:low"


def run(prompt: Path, *, cwd: Path, log_dir: Path, timeout_minutes: float, model: str = MODEL) -> str:
    """Run Pi on ``prompt`` from ``cwd``, log its transcript in ``log_dir``, and return its final message.

    Pi loads ``cwd``'s ``.pi/mcp.json`` but no context files, so the prompt is its only
    instructions. Each transcript event gets a ``t`` field, the seconds since Pi launched
    when the event arrived, because Pi's own events mostly lack timestamps. Raises
    ``subprocess.TimeoutExpired`` after killing Pi and its MCP servers when it runs past
    ``timeout_minutes``.
    """
    command = [
        "pi", "--mode", "json", "--no-session",
        "--no-context-files",
        "--no-extensions", *(arg for extension in EXTENSIONS for arg in ("-e", extension)),
        "--no-skills", *(arg for skill in SKILLS for arg in ("--skill", skill)),
        "--approve",  # load the .pi/mcp.json without a trust prompt
        "--exclude-tools", EXCLUDED_TOOLS,
        "--model", model,
        f"@{prompt}",
    ]
    transcript_path = log_dir / "transcript.jsonl"

    with (log_dir / "stderr.log").open("w") as stderr:
        # A session of its own, so a timeout can kill Pi together with its MCP servers.
        agent = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=stderr, start_new_session=True)
        copier = threading.Thread(target=_timestamp, args=(agent.stdout, transcript_path, time.monotonic()))
        copier.start()

        try:
            agent.wait(timeout=timeout_minutes * 60)
        finally:
            if agent.poll() is None:  # timed out, or interrupted
                os.killpg(agent.pid, signal.SIGKILL)
                agent.wait()
            copier.join()

    return final_message(transcript_path)


def _timestamp(stdout: IO[bytes], transcript: Path, launched: float) -> None:
    """Copy Pi's JSON events to ``transcript`` as they arrive, each with ``t`` inserted as its first field."""
    with transcript.open("wb", buffering=0) as out:  # unbuffered, so a running agent's transcript is current
        for line in stdout:
            if line.strip():
                out.write(b'{"t":%.3f,' % (time.monotonic() - launched) + line.removeprefix(b"{"))


def events(transcript: Path) -> Iterator[dict]:
    """Yield the events of a Pi JSON-mode transcript one at a time; transcripts reach about 100 MB."""
    # Binary lines end at LF only, as Pi frames records; str.splitlines() would also split on
    # Unicode separators inside strings.
    with transcript.open("rb") as lines:
        for line in lines:
            if line.strip():
                yield json.loads(line)


def final_message(transcript: Path) -> str:
    """Return the text of the agent's last message in a Pi JSON-mode transcript, or its error."""
    final = ""

    for event in events(transcript):
        if event.get("type") == "message_end" and event["message"]["role"] == "assistant":
            message = event["message"]
            text = "".join(block["text"] for block in message["content"] if block["type"] == "text")
            final = text or message.get("errorMessage", "")

    return final
