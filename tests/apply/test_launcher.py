import json

import pytest

from jobs.apply.launcher import Result, _final_message, parse_result


def block(result: dict) -> str:
    return f"Done.\n\n```json\n{json.dumps(result)}\n```"


@pytest.mark.parametrize("result", [
    {"status": "applied", "reason": None, "explanation": "Submitted."},
    {"status": "dry_run", "reason": None, "explanation": "Filled."},
    {"status": "failed", "reason": "missing_fact", "explanation": "No ZIP code."},
])
def test_parses_valid_results(result):
    assert parse_result(block(result)) == Result(**result)


def test_uses_the_last_json_block():
    message = block({"status": "failed", "reason": "stuck", "explanation": "x"}) + "\n" + block(
        {"status": "applied", "reason": None, "explanation": "y"})

    assert parse_result(message).status == "applied"


@pytest.mark.parametrize("message", [
    "I applied.",  # no block
    "```json\n{not json}\n```",
    block({"status": "applied", "reason": None}),  # missing field
    block({"status": "done", "reason": None, "explanation": "x"}),  # unknown status
    block({"status": "failed", "reason": None, "explanation": "x"}),  # failure without a reason
    block({"status": "applied", "reason": "stuck", "explanation": "x"}),  # success with a reason
])
def test_rejects_missing_or_malformed_results(message):
    assert parse_result(message).reason == "no_result"


def test_final_message_is_the_last_assistant_text(tmp_path):
    def message_end(role, text):
        return {"type": "message_end", "message": {"role": role, "content": [{"type": "text", "text": text}]}}

    # U+2028 separates lines for splitlines() but is not a record boundary in Pi's JSONL.
    events = [message_end("user", "prompt"), message_end("assistant", "first"), {"type": "agent_end"},
              message_end("assistant", "line one\u2028still the same record")]
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))

    assert _final_message(transcript) == "line one\u2028still the same record"
