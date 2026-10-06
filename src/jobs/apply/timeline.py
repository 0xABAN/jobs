"""Where an apply run spent its time: ``jobs timeline [run id]``.

The launcher's phases come from the run's ``result.json``. The agent's steps come from
its transcript, whose events ``pi.run`` stamps with ``t``, the seconds since Pi launched.
Each agent turn is one model call, then the tools it called. The model call splits into
the wait for its first token, thinking, and writing the reply and tool calls; the tools
include the browser and other MCP calls that each codemode script made.
"""

import json
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path



@dataclass
class Call:
    name: str
    seconds: float
    nested: bool  # made by a codemode script, not by the model


@dataclass
class Turn:
    start: float
    first_token: float | None = None
    thinking: float = 0.0
    model_end: float | None = None  # when the model's message ended and its tools started
    output_tokens: int = 0
    end: float | None = None
    calls: list[Call] = field(default_factory=list)


def read_turns(transcript: Path) -> tuple[list[Turn], float]:
    """Return the agent's turns and the time of the transcript's last event, in seconds since Pi launched."""
    turns, started, model_calls = [], {}, set()
    thinking_since = last = 0.0

    for line in transcript.read_text(encoding="utf-8").split("\n"):
        if not line.strip():
            continue

        event = json.loads(line)
        if "t" not in event:
            raise ValueError(f"{transcript} has no timestamps: it predates timestamped transcripts")
        last, kind = event["t"], event["type"]

        if kind == "turn_start":
            turns.append(Turn(start=last))
        elif kind == "message_update":
            turn = turns[-1]
            if turn.first_token is None:
                turn.first_token = last

            step = event["assistantMessageEvent"]["type"]
            if step == "thinking_start":
                thinking_since = last
            elif step == "thinking_end":
                turn.thinking += last - thinking_since
        elif kind == "message_end" and event["message"]["role"] == "assistant":
            turns[-1].model_end = last
            turns[-1].output_tokens = event["message"]["usage"]["output"]
            model_calls |= {block["id"] for block in event["message"]["content"] if block["type"] == "toolCall"}
        elif kind == "tool_execution_start":
            started[event["toolCallId"]] = last
        elif kind == "tool_execution_end":
            call_id = event["toolCallId"]
            name = event["toolName"]
            if name.startswith("mcp__"):  # mcp__<server>__<tool>: the tool name says enough
                name = name.split("__", 2)[2]
            turns[-1].calls.append(Call(name, last - started.pop(call_id), nested=call_id not in model_calls))
        elif kind == "turn_end":
            turns[-1].end = last

    return turns, last


def timeline(run_dir: Path) -> str:
    """Describe where the run in ``run_dir`` spent its time, turn by turn, with totals and the slowest calls."""
    lines = [f"Run {run_dir.name}"]

    if (result_path := run_dir / "result.json").exists():
        result = json.loads(result_path.read_text(encoding="utf-8"))
        outcome = result["status"] + (f" ({result['reason']})" if result["reason"] else "")
        phases = " · ".join(f"{name} {seconds:.1f}s" for name, seconds in result["phases"].items())
        lines += [f"Result: {outcome}", f"Launcher: {phases}"]
    else:
        lines.append("Result: still running")

    turns, elapsed = read_turns(run_dir / "transcript.jsonl")
    lines += ["", "turn  start   model (  wait  think  write)    out   tools  calls"]
    for number, turn in enumerate(turns, 1):
        lines.append(f"{number:>4} {turn.start:>6.1f}  {_model(turn)}  {_tools(turn)}")

    lines += ["", *_totals(turns, elapsed), "", *_slowest(turns)]
    return "\n".join(lines)


def _model(turn: Turn) -> str:
    """Format a turn's model call as ``model (wait think write) output-tokens``."""
    if turn.model_end is None:
        return f"{'running':>40}"

    model = turn.model_end - turn.start
    wait = (turn.first_token or turn.model_end) - turn.start
    write = model - wait - turn.thinking
    return f"{model:>6.1f} ({wait:>6.1f} {turn.thinking:>6.1f} {write:>6.1f}) {turn.output_tokens:>6}"


def _tools(turn: Turn) -> str:
    """Format a turn's tool time and its calls; a codemode call lists the MCP calls its script made."""
    if turn.model_end is None:
        return ""

    tools = f"{turn.end - turn.model_end:>6.1f}" if turn.end is not None else f"{'running':>6}"
    nested = _by_name(call for call in turn.calls if call.nested)
    inside = ", ".join(f"{name}{'×' + str(len(times)) if len(times) > 1 else ''} {sum(times):.1f}"
                       for name, times in nested.items())

    calls = []
    for call in (call for call in turn.calls if not call.nested):
        calls.append(f"{call.name} {call.seconds:.1f}" + (f": {inside}" if call.name == "codemode" and inside else ""))
    return f"{tools}  {' · '.join(calls)}"


def _totals(turns: list[Turn], elapsed: float) -> list[str]:
    finished = [turn for turn in turns if turn.model_end is not None]
    model = sum(turn.model_end - turn.start for turn in finished)
    wait = sum((turn.first_token or turn.model_end) - turn.start for turn in finished)
    thinking = sum(turn.thinking for turn in finished)
    tools = sum(turn.end - turn.model_end for turn in finished if turn.end is not None)
    startup = turns[0].start if turns else elapsed

    def share(seconds: float) -> str:
        return f"{seconds:.1f}s ({seconds / elapsed:.0%})" if elapsed else f"{seconds:.1f}s"

    return [
        f"Agent: {elapsed:.1f}s over {len(turns)} turns",
        f"  model   {share(model)}: waiting {wait:.1f}s, thinking {thinking:.1f}s, writing {model - wait - thinking:.1f}s",
        f"  tools   {share(tools)}",
        f"  startup {share(startup)} before the first turn",
    ]


def _slowest(turns: list[Turn], count: int = 10) -> list[str]:
    """Rank tools by total time, with how often they ran and their mean and longest run."""
    by_name = _by_name(call for turn in turns for call in turn.calls)
    ranked = sorted(by_name.items(), key=lambda item: sum(item[1]), reverse=True)[:count]

    lines = ["call                        runs   total    mean     max"]
    for name, times in ranked:
        lines.append(f"{name:<26} {len(times):>6} {sum(times):>7.1f} {sum(times) / len(times):>7.1f} {max(times):>7.1f}")
    return lines


def _by_name(calls) -> dict[str, list[float]]:
    times = defaultdict(list)
    for call in calls:
        times[call.name].append(call.seconds)
    return times
