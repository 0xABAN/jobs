"""How an application ended: the JSON result an apply agent reports, validated."""

import json
import re
from dataclasses import dataclass

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
