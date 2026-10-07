"""Command-line entry point: ``uv run jobs <command>``."""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict

from jobs import pi
from jobs.apply.launcher import RUNS_DIR, apply
from jobs.apply.timeline import timeline
from jobs.apply.workers import running
from jobs.captcha import solve
from jobs.chrome import launch
from jobs.config import CHROME_PROFILE, load_profile
from jobs.mail import GRACE_MINUTES, authorize, clean_confirmations, clean_now_and_then, schedule


def main() -> None:
    parser = argparse.ArgumentParser(prog="jobs", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    apply_command = commands.add_parser("apply", help="apply to jobs in parallel; print one JSON result per job")
    apply_command.add_argument("urls", nargs="+", metavar="url", help="job posting URLs")
    apply_command.add_argument("--dry-run", action="store_true", help="fill everything but do not submit")
    apply_command.add_argument("--workers", type=int, default=6, help="parallel workers, shared by every run (default 6)")
    apply_command.add_argument("--first-worker", type=int, default=0,
                               help="number of the first worker to use, so parallel experiments keep separate workers (default 0)")
    apply_command.add_argument("--timeout", type=float, default=60, help="minutes before an agent is stopped (default 60)")
    apply_command.add_argument("--model", default=pi.MODEL, help="Pi model pattern and thinking level (default: %(default)s)")

    commands.add_parser("status", help="list the jobs workers are applying to now")

    browse = commands.add_parser("browse", help="open the jobs Chrome profile in the background and print its pid")
    browse.add_argument("url", nargs="?", default="about:blank")

    captcha = commands.add_parser("captcha", help="solve the CAPTCHA blocking a page in a harness Chrome; print JSON")
    captcha.add_argument("port", type=int, help="that Chrome's DevTools port")

    commands.add_parser("mail-auth", help="grant the Gmail cleanup its own token, which can move mail to Trash")

    clean_mail = commands.add_parser("clean-mail", help="move automated application receipts and codes to Gmail's Trash")
    clean_mail.add_argument("--days", type=int, default=2, help="look back this many days (default 2)")
    clean_mail.add_argument("--grace", type=float, default=GRACE_MINUTES,
                            help="skip mail younger than this many minutes, which a running agent may still read "
                                 "(default %(default)s)")

    mail_schedule = commands.add_parser("mail-schedule", help="have launchd run clean-mail every few minutes")
    mail_schedule.add_argument("--every", type=int, default=15, help="minutes between cleanups (default 15)")
    clean_mail.add_argument("--dry-run", action="store_true", help="list what would be trashed without trashing it")

    timeline_command = commands.add_parser("timeline", help="show where an apply run spent its time, step by step")
    timeline_command.add_argument("run", nargs="?", help="run id, a directory name in ~/.jobs/runs (default: the latest)")

    args = parser.parse_args()

    if args.command == "apply":
        def run(url: str) -> str:
            try:
                result = asdict(apply(url, dry_run=args.dry_run, timeout_minutes=args.timeout,
                                      workers=args.workers, first_worker=args.first_worker, model=args.model))
            except Exception as error:  # report it and let the other jobs finish
                result = {"status": "error", "explanation": repr(error)}

            print(json.dumps({"url": url, **result}), flush=True)
            clean_mail_after(grace_minutes=GRACE_MINUTES)
            return result["status"]

        with ThreadPoolExecutor(args.workers) as pool:
            statuses = list(pool.map(run, dict.fromkeys(args.urls)))  # each URL once, in order
        sys.exit(any(status in ("failed", "error") for status in statuses))

    if args.command == "status":
        print("\n".join(running()) or "No jobs running.")

    if args.command == "browse":
        print(launch(CHROME_PROFILE, args.url))

    if args.command == "captcha":
        outcome = solve(args.port)
        print(json.dumps(outcome))
        sys.exit("error" in outcome)

    if args.command == "mail-auth":
        authorize(load_profile()["personal"]["email"])
        print("Saved the Gmail cleanup token.")

    if args.command == "clean-mail":
        for message in clean_confirmations(load_profile()["tracker"]["sheet_id"], grace_minutes=args.grace,
                                           days=args.days, dry_run=args.dry_run):
            print(json.dumps(message), flush=True)

    if args.command == "mail-schedule":
        schedule(args.every)
        print(f"clean-mail now runs every {args.every} minutes; its log is ~/.jobs/mail-cleanup.log")

    if args.command == "timeline":
        print(timeline(RUNS_DIR / args.run if args.run else max(RUNS_DIR.iterdir())))


def clean_mail_after(*, grace_minutes: float) -> None:
    """Trash finished runs' receipts and codes now and then; report on stderr, so stdout keeps one line per job."""
    try:
        trashed = clean_now_and_then(load_profile()["tracker"]["sheet_id"], grace_minutes=grace_minutes)
    except Exception as error:  # the jobs went through either way; say so and keep applying
        print(json.dumps({"mail_cleanup": "error", "explanation": repr(error)}), file=sys.stderr, flush=True)
        return

    if trashed:
        print(json.dumps({"mail_cleanup": "trashed", "messages": len(trashed)}), file=sys.stderr, flush=True)
