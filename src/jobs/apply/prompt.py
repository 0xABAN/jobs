"""Render the per-job apply prompt from the applicant profile.

``prompt.md`` is a ``string.Template``: this module fills its ``${name}``
placeholders, and a literal dollar sign in the template is written ``$$``.
The rendered prompt is self-contained, as in ApplyPilot: the apply agent gets
every fact it needs from the prompt and never reads repository files for them.
"""

import subprocess
from datetime import date
from pathlib import Path
from string import Template

from jobs.config import REPO_ROOT

TEMPLATE_PATH = Path(__file__).with_name("prompt.md")

# Profile sections that configure the harness rather than describe Adam. They
# fill dedicated slots in the template instead of the applicant profile.
HARNESS_SECTIONS = {"excluded_companies", "resumes", "tracker"}

# Annual salary to hourly rate, as in ApplyPilot: 40 hours x 52 weeks.
HOURS_PER_YEAR = 2080

# Words in profile keys that read as acronyms in the rendered profile.
ACRONYMS = {"eeo", "gpa", "sat", "url"}


def render_prompt(job_url: str, *, dry_run: bool, profile: dict, today: date) -> str:
    """Return the complete apply prompt for one job.

    Raises ``KeyError`` when the profile lacks a field the template needs, and
    ``subprocess.CalledProcessError`` when a resume PDF cannot be read.
    """
    personal = profile["personal"]
    tracker = profile["tracker"]
    resumes = {kind: (REPO_ROOT / path).resolve() for kind, path in profile["resumes"].items()}

    template = Template(TEMPLATE_PATH.read_text(encoding="utf-8"))
    return template.substitute(
        job_url=job_url,
        run_mode=_format_run_mode(dry_run),
        resume_full_time=resumes["full_time"],
        resume_internship=resumes["internship"],
        resume_full_time_text=_extract_text(resumes["full_time"]),
        resume_internship_text=_extract_text(resumes["internship"]),
        tracker=f"the `{tracker['tab']}` tab of Google Sheet `{tracker['sheet_id']}`",
        tracker_columns=" | ".join(tracker["columns"]),
        excluded_companies=", ".join(profile["excluded_companies"]),
        salary_rules=_format_salary_rules(profile["compensation"]),
        login_rule=_format_login_rule(personal),
        legal_name=personal["full_name"],
        today=today.strftime("%m/%d/%Y"),
        applicant_profile=_format_profile(profile),
    )


def _format_run_mode(dry_run: bool) -> str:
    if dry_run:
        return (
            "**Dry run.** Do everything except the final submit click, then end "
            "the browser session and finish with `RESULT:DRY_RUN`."
        )

    return "**Live run.** Submit the application once every check in step 8 passes."


def _format_salary_rules(compensation: dict) -> str:
    """Return the salary rules as Markdown bullets nested under the template's Salary item."""
    floor = compensation["salary_floor"]
    currency = compensation["salary_currency"]
    range_min = compensation["salary_range_min"]
    range_max = compensation["salary_range_max"]
    hourly = round(floor / HOURS_PER_YEAR)

    return "\n".join([
        f"  - Full-time roles: answer the larger of the posted range's midpoint and "
        f"${floor:,} {currency}, capped at the posted maximum. With no posted "
        f"range, answer ${floor:,} {currency}.",
        f"  - Asked for a range when none is posted: ${range_min:,}–${range_max:,} {currency}.",
        f"  - Hourly roles: the posted range's midpoint, otherwise ${hourly}/hour "
        f"(${floor:,} divided by {HOURS_PER_YEAR} hours).",
    ])


def _format_login_rule(personal: dict) -> str:
    if personal["password"]:
        return (
            f"sign in, or create an account, with `{personal['email']}` and the "
            f"password `{personal['password']}`. When both fail, end with "
            f"`RESULT:LOGIN_ISSUE`"
        )

    return "end with `RESULT:LOGIN_ISSUE`: no account password is configured"


def _format_profile(profile: dict) -> str:
    """Format Adam's answers as Markdown, one subsection per profile section.

    Empty answers are left out so the agent treats them as unknown, and the
    account password is left out because the login rule already carries it.
    """
    blocks = []

    for section, answers in profile.items():
        if section in HARNESS_SECTIONS:
            continue

        lines = [f"### {_humanize(section)}"]
        for key, value in answers.items():
            if section == "personal" and key == "password":
                continue
            if value in ("", [], None):
                continue

            shown = ", ".join(value) if isinstance(value, list) else value
            lines.append(f"- {_humanize(key)}: {shown}")

        blocks.append("\n".join(lines))

    return "\n\n".join(blocks)


def _humanize(key: str) -> str:
    """Turn a profile key such as ``linkedin_url`` into a label such as ``Linkedin URL``."""
    words = [word.upper() if word in ACRONYMS else word for word in key.split("_")]
    words[0] = words[0][0].upper() + words[0][1:]
    return " ".join(words)


def _extract_text(pdf: Path) -> str:
    """Return a resume's text as employers' parsers see it, via Poppler's pdftotext."""
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()
