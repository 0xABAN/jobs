"""Render the prompt for one job application.

``prompt.md`` holds the rules as a ``string.Template``: ``${name}`` placeholders
are filled here, and ``$$`` is a literal dollar sign. Adam's profile is embedded
as JSON; the agent reads the resume it chooses itself.
"""

import json
from datetime import date
from pathlib import Path
from string import Template

from jobs.config import BANNED_SITES, REPO_ROOT

TEMPLATE_PATH = Path(__file__).with_name("prompt.md")


def render_prompt(job_url: str, *, dry_run: bool, profile: dict, today: date, session: str, chrome_pid: int,
                  devtools_port: int) -> str:
    """Return the complete prompt for applying to one job in the Chrome the launcher opened."""
    if dry_run:
        # A stray Return can submit a form; on Greenhouse that only sends a security code, and
        # entering it would complete a real application.
        run_mode = ("**Dry run:** do everything except the final submit click, and finish with status `dry_run`. "
                    "If the site asks for a security or verification code, the form was submitted by accident: "
                    "never enter the code; finish with status `dry_run` and say so in the explanation.")
    else:
        run_mode = "**Live run:** submit the application once every check in step 7 passes."

    return Template(TEMPLATE_PATH.read_text(encoding="utf-8")).substitute(
        job_url=job_url,
        run_mode=run_mode,
        today=today.strftime("%m/%d/%Y"),
        repo_root=REPO_ROOT,
        session=session,
        chrome_pid=chrome_pid,
        devtools_port=devtools_port,
        banned_sites=", ".join(BANNED_SITES),
        # The launcher, not the agent, keeps the tracker.
        profile=json.dumps({k: v for k, v in profile.items() if k != "tracker"}, indent=2, ensure_ascii=False),
    )
