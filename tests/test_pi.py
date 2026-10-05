import json

from jobs.pi import final_message, run


def test_final_message_is_the_last_assistant_text(tmp_path):
    def message_end(role, text):
        return {"type": "message_end", "message": {"role": role, "content": [{"type": "text", "text": text}]}}

    # U+2028 separates lines for splitlines() but is not a record boundary in Pi's JSONL.
    events = [message_end("user", "prompt"), message_end("assistant", "first"), {"type": "agent_end"},
              message_end("assistant", "line one\u2028still the same record")]
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))

    assert final_message(transcript) == "line one\u2028still the same record"


def test_run_stamps_each_event_with_its_arrival_time(tmp_path, monkeypatch):
    # A stand-in for Pi that emits two events half a second apart.
    fake_pi = tmp_path / "bin/pi"
    fake_pi.parent.mkdir()
    fake_pi.write_text(
        "#!/bin/sh\n"
        "echo '{\"type\":\"agent_start\"}'\n"
        "sleep 0.5\n"
        "echo '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]}}'\n"
    )
    fake_pi.chmod(0o755)
    monkeypatch.setenv("PATH", f"{fake_pi.parent}:/usr/bin:/bin")

    assert run(tmp_path / "prompt.md", cwd=tmp_path, log_dir=tmp_path, timeout_minutes=1) == "done"

    first, second = (json.loads(line) for line in (tmp_path / "transcript.jsonl").read_text().splitlines())
    # The first exec of a new script can take most of a second on macOS, so only the gap is exact.
    assert first["type"] == "agent_start" and first["t"] > 0
    assert 0.5 <= second["t"] - first["t"] < 1.0
