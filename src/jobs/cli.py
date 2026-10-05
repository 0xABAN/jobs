"""Command-line entry point: ``uv run jobs <command>``."""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from jobs.apply.launcher import apply
from jobs.apply.workers import running
from jobs.chrome import launch
from jobs.config import CHROME_PROFILE


def main() -> None:
    parser = argparse.ArgumentParser(prog="jobs", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    apply_command = commands.add_parser("apply", help="apply to jobs in parallel; print one JSON result per job")
    apply_command.add_argument("urls", nargs="+", metavar="url", help="job posting URLs")
    apply_command.add_argument("--dry-run", action="store_true", help="fill everything but do not submit")
    apply_command.add_argument("--workers", type=int, default=3, help="parallel workers, shared by every run (default 3)")
    apply_command.add_argument("--timeout", type=float, default=15, help="minutes before an agent is stopped (default 15)")
    apply_command.add_argument("--model", help="Pi model pattern, e.g. claude-sonnet-5-5:low (default: Pi's)")

    commands.add_parser("status", help="list the jobs workers are applying to now")

    browse = commands.add_parser("browse", help="open the jobs Chrome profile in the background and print its pid")
    browse.add_argument("url", nargs="?", default="about:blank")

    args = parser.parse_args()

    if args.command == "apply":
        def run(url: str) -> str:
            try:
                result = asdict(apply(url, dry_run=args.dry_run, timeout_minutes=args.timeout,
                                      workers=args.workers, model=args.model))
            except Exception as error:  # report it and let the other jobs finish
                result = {"status": "error", "explanation": repr(error)}

            print(json.dumps({"url": url, **result}), flush=True)
            return result["status"]

        with ThreadPoolExecutor(args.workers) as pool:
            statuses = list(pool.map(run, dict.fromkeys(args.urls)))  # each URL once, in order
        sys.exit(any(status in ("failed", "error") for status in statuses))

    if args.command == "status":
        print("\n".join(running()) or "No jobs running.")

    if args.command == "browse":
        print(launch(CHROME_PROFILE, args.url))
