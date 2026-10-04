"""Command-line entry point: ``uv run jobs <command>``."""

import argparse
import json
import sys
from dataclasses import asdict

from jobs.apply.launcher import apply


def main() -> None:
    parser = argparse.ArgumentParser(prog="jobs", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    apply_command = commands.add_parser("apply", help="apply to one job and print the result")
    apply_command.add_argument("url", help="job posting URL")
    apply_command.add_argument("--dry-run", action="store_true", help="fill everything but do not submit")
    apply_command.add_argument("--timeout", type=float, default=15, help="minutes before the agent is stopped (default 15)")
    apply_command.add_argument("--model", help="Pi model pattern, e.g. claude-sonnet-5-5:low (default: Pi's)")

    args = parser.parse_args()

    if args.command == "apply":
        result = apply(args.url, dry_run=args.dry_run, timeout_minutes=args.timeout, model=args.model)
        print(json.dumps(asdict(result)))
        sys.exit(result.status == "failed")
