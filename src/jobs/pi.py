"""Run a headless Pi agent on a prompt file and read its final message."""

import json
import os
import signal
import subprocess
from pathlib import Path

# Extension tools a headless agent must not use: they spawn agents or message other Pi sessions.
EXCLUDED_TOOLS = "Agent,SubagentWorkflow,get_subagent_result,steer_subagent,intercom,create_goal,todo"


def run(prompt: Path, *, cwd: Path, log_dir: Path, timeout_minutes: float, model: str | None = None) -> str:
    """Run Pi on ``prompt`` from ``cwd``, log its transcript in ``log_dir``, and return its final message.

    Pi loads ``cwd``'s ``.pi/mcp.json`` but no context files, so the prompt is its only
    instructions. Raises ``subprocess.TimeoutExpired`` after killing Pi and its MCP
    servers when it runs past ``timeout_minutes``.
    """
    command = [
        "pi", "--mode", "json", "--no-session",
        "--no-context-files",
        "--approve",  # load the .pi/mcp.json without a trust prompt
        "--exclude-tools", EXCLUDED_TOOLS,
        *(["--model", model] if model else []),
        f"@{prompt}",
    ]
    transcript_path = log_dir / "transcript.jsonl"

    with transcript_path.open("w", encoding="utf-8") as transcript, (log_dir / "stderr.log").open("w") as stderr:
        # A session of its own, so a timeout can kill Pi together with its MCP servers.
        agent = subprocess.Popen(command, cwd=cwd, stdout=transcript, stderr=stderr, start_new_session=True)
        try:
            agent.wait(timeout=timeout_minutes * 60)
        except subprocess.TimeoutExpired:
            os.killpg(agent.pid, signal.SIGKILL)
            agent.wait()
            raise

    return final_message(transcript_path)


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
