"""Render the prompt for one job application.

``prompt.md`` holds the rules as a ``string.Template``: ``${name}`` placeholders
are filled here, and ``$$`` is a literal dollar sign. Adam's profile is embedded
as JSON; the agent reads the resume it chooses itself.
"""

import json
from datetime import date
from string import Template

from jobs.config import REPO_ROOT

TEMPLATE_PATH = REPO_ROOT / "src/jobs/apply/prompt.md"


def render_prompt(job_url: str, *, dry_run: bool, profile: dict, today: date, session: str, chrome_pid: int) -> str:
    """Return the complete prompt for applying to one job in the Chrome the launcher opened."""
    if dry_run:
        run_mode = "**Dry run:** do everything except the final submit click, and finish with status `dry_run`."
    else:
        run_mode = "**Live run:** submit the application once every check in step 8 passes."

    return Template(TEMPLATE_PATH.read_text(encoding="utf-8")).substitute(
        job_url=job_url,
        run_mode=run_mode,
        today=today.strftime("%m/%d/%Y"),
        repo_root=REPO_ROOT,
        session=session,
        chrome_pid=chrome_pid,
        profile=json.dumps(profile, indent=2, ensure_ascii=False),
    )
