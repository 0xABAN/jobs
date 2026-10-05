import json

from jobs.apply.timeline import read_turns, timeline


def event(t, kind, **fields):
    return json.dumps({"t": t, "type": kind, **fields})


def update(t, step):
    return event(t, "message_update", assistantMessageEvent={"type": step})


def assistant(t, *call_ids, output=100):
    content = [{"type": "toolCall", "id": call_id, "name": "codemode"} for call_id in call_ids]
    return event(t, "message_end", message={"role": "assistant", "content": content, "usage": {"output": output}})


def tool(t, kind, call_id, name):
    return event(t, f"tool_execution_{kind}", toolCallId=call_id, toolName=name)


# One finished turn: 1 s waiting, 2 s thinking, 1 s writing a codemode call whose script
# spends 3 s of its 5 s in two CUA calls; then a second turn still writing its reply.
TRANSCRIPT = [
    event(0.5, "session"),
    event(2.0, "turn_start"),
    update(3.0, "thinking_start"), update(5.0, "thinking_end"), update(5.5, "toolcall_start"),
    assistant(6.0, "model-call"),
    tool(6.0, "start", "model-call", "codemode"),
    tool(6.5, "start", "cua-1", "mcp__cua_driver__get_window_state"), tool(8.5, "end", "cua-1", "mcp__cua_driver__get_window_state"),
    tool(9.0, "start", "cua-2", "mcp__cua_driver__click"), tool(10.0, "end", "cua-2", "mcp__cua_driver__click"),
    tool(11.0, "end", "model-call", "codemode"),
    event(11.0, "turn_end"),
    event(11.0, "turn_start"),
    update(14.0, "text_start"),
]


def test_splits_each_turn_into_model_and_tool_time(tmp_path):
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text("\n".join(TRANSCRIPT) + "\n")

    turns, elapsed = read_turns(transcript)

    first, second = turns
    assert (first.start, first.first_token, first.thinking, first.model_end, first.end) == (2.0, 3.0, 2.0, 6.0, 11.0)
    assert [(call.name, call.seconds, call.nested) for call in first.calls] == [
        ("get_window_state", 2.0, True), ("click", 1.0, True), ("codemode", 5.0, False),
    ]
    assert (second.first_token, second.model_end) == (14.0, None)
    assert elapsed == 14.0


def test_timeline_of_a_running_run(tmp_path):
    (tmp_path / "transcript.jsonl").write_text("\n".join(TRANSCRIPT) + "\n")

    report = timeline(tmp_path)

    assert "Result: still running" in report
    assert "   1    2.0     4.0 (   1.0    2.0    1.0)    100     5.0  codemode 5.0: get_window_state 2.0, click 1.0" in report
    assert "  model   4.0s (29%): waiting 1.0s, thinking 2.0s, writing 1.0s" in report
    assert "codemode                        1     5.0     5.0     5.0" in report
