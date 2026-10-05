import json

import pytest

from jobs.apply.result import Result, parse_result


def block(result: dict) -> str:
    return f"Done.\n\n```json\n{json.dumps(result)}\n```"


@pytest.mark.parametrize("result", [
    {"status": "applied", "reason": None, "explanation": "Submitted.", "company": "Acme", "role": "Intern",
     "salary": "$40/hour"},
    {"status": "dry_run", "reason": None, "explanation": "Filled."},
    {"status": "failed", "reason": "missing_fact", "explanation": "No ZIP code."},
    {"status": "failed", "reason": "stuck", "explanation": "x", "account": "acme.wd5.myworkdayjobs.com"},
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
    block({"status": "skipped", "reason": "in_progress", "explanation": "x"}),  # launcher-only status
])
def test_rejects_missing_or_malformed_results(message):
    assert parse_result(message).reason == "no_result"
