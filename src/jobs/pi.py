"""Run a headless Pi agent on a prompt file and read its final message."""

import json
import os
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import IO

# The only extensions an apply agent needs: MCP servers, codemode, and the Claude provider. Adam's
# other global extensions would add seconds to every start, and tools a headless agent must not have.
EXTENSIONS = ["builtin:mcp", "builtin:codemode", str(Path.home() / ".pi/agent/npm/node_modules/pi-claude-bridge")]

# The only skill the apply prompt uses, for required essays.
SKILLS = [str(Path.home() / ".pi/agent/skills/write")]

# The Claude provider's tool that hands work to a Claude Code agent; a headless agent must not spawn agents.
EXCLUDED_TOOLS = "AskClaude"

# Apply agents' model and thinking level, fixed so Adam's interactive Pi defaults don't change them.
# GPT through the Codex subscription keeps the apply agents off Adam's Claude usage.
MODEL = "openai-codex/gpt-6-astra:medium"


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
        except subprocess.TimeoutExpired:
            os.killpg(agent.pid, signal.SIGKILL)
            agent.wait()
            raise
        finally:
            copier.join()

    return final_message(transcript_path)


def _timestamp(events: IO[bytes], transcript: Path, launched: float) -> None:
    """Copy Pi's JSON events to ``transcript`` as they arrive, each with ``t`` inserted as its first field."""
    with transcript.open("wb", buffering=0) as out:  # unbuffered, so a running agent's transcript is current
        for line in events:
            if line.strip():
                out.write(b'{"t":%.3f,' % (time.monotonic() - launched) + line.removeprefix(b"{"))


def final_message(transcript: Path) -> str:
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
