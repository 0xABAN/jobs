import json

from jobs.pi import final_message


def test_final_message_is_the_last_assistant_text(tmp_path):
    def message_end(role, text):
        return {"type": "message_end", "message": {"role": role, "content": [{"type": "text", "text": text}]}}

    # U+2028 separates lines for splitlines() but is not a record boundary in Pi's JSONL.
    events = [message_end("user", "prompt"), message_end("assistant", "first"), {"type": "agent_end"},
              message_end("assistant", "line one\u2028still the same record")]
    transcript = tmp_path / "transcript.jsonl"
    transcript.write_text("".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))

    assert final_message(transcript) == "line one\u2028still the same record"
