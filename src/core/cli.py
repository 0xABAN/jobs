"""Command-line entry point: ``uv run jobs <command>``."""

import argparse
from datetime import date

from core.prompt import load_profile, render_prompt


def main() -> None:
    parser = argparse.ArgumentParser(prog="jobs", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    prompt = commands.add_parser("prompt", help="print the apply prompt for one job")
    prompt.add_argument("url", help="job posting URL")
    prompt.add_argument("--dry-run", action="store_true", help="fill everything but do not submit")

    args = parser.parse_args()

    if args.command == "prompt":
        print(render_prompt(args.url, dry_run=args.dry_run, profile=load_profile(), today=date.today()))
