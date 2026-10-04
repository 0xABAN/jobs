"""Build the prompt for one job application.

The template, ``prompt.md``, holds the rules. This module fills in everything
that depends on the job or on Adam's profile. As in ApplyPilot, the result is
self-contained: the apply agent learns everything about Adam from the prompt
and never reads repository files.

The template uses ``string.Template`` syntax: ``${name}`` marks a value filled
in here, and ``$$`` is a literal dollar sign.
"""

import subprocess
from datetime import date
from pathlib import Path
from string import Template

from jobs.config import REPO_ROOT

TEMPLATE_PATH = Path(__file__).with_name("prompt.md")

# Profile sections that configure the harness rather than describe Adam. They
# fill specific places in the prompt instead of appearing in the answer list.
SETTINGS_SECTIONS = {"excluded_companies", "resumes", "tracker"}

# A working year (40 hours x 52 weeks), for turning a salary into an hourly rate.
WORK_HOURS_PER_YEAR = 2080

# Words written in capitals when profile keys become labels, e.g. "gpa" -> "GPA".
ACRONYMS = {"eeo", "gpa", "sat", "url"}


def render_prompt(job_url: str, *, dry_run: bool, profile: dict, today: date) -> str:
    """Return the complete prompt for applying to one job.

    Raises ``KeyError`` when the profile lacks a field the prompt needs, and
    ``subprocess.CalledProcessError`` when a resume PDF cannot be read.
    """
    personal = profile["personal"]
    tracker = profile["tracker"]
    resumes = {kind: REPO_ROOT / path for kind, path in profile["resumes"].items()}

    values = {
        # The job and whether to submit it.
        "job_url": job_url,
        "run_mode": _describe_run_mode(dry_run),

        # Resumes: the PDF to upload, and the text the agent answers from.
        "resume_full_time": resumes["full_time"],
        "resume_internship": resumes["internship"],
        "resume_full_time_text": _read_pdf_text(resumes["full_time"]),
        "resume_internship_text": _read_pdf_text(resumes["internship"]),

        # The Google Sheet that records applications.
        "tracker": f"the `{tracker['tab']}` tab of Google Sheet `{tracker['sheet_id']}`",
        "tracker_columns": " | ".join(tracker["columns"]),

        # Rules that depend on Adam's settings.
        "excluded_companies": ", ".join(profile["excluded_companies"]),
        "salary_rules": _describe_salary_rules(profile["compensation"]),
        "login_rule": _describe_login_rule(personal),
        "legal_name": personal["full_name"],
        "today": today.strftime("%m/%d/%Y"),

        # Everything Adam has answered, for filling in forms.
        "applicant_profile": _list_answers(profile),
    }

    template = Template(TEMPLATE_PATH.read_text(encoding="utf-8"))
    return template.substitute(values)


def _describe_run_mode(dry_run: bool) -> str:
    if dry_run:
        return (
            "**Dry run.** Do everything except the final submit click, then end "
            "the browser session and finish with `RESULT:DRY_RUN`."
        )

    return "**Live run.** Submit the application once every check in step 8 passes."


def _describe_salary_rules(compensation: dict) -> str:
    """Return the salary rules as bullets nested under the template's "Salary" item."""
    currency = compensation["salary_currency"]
    floor = _dollars(compensation["salary_floor"])
    hourly_floor = _dollars(round(compensation["salary_floor"] / WORK_HOURS_PER_YEAR))
    fallback_range = (
        f"{_dollars(compensation['salary_range_min'])}–{_dollars(compensation['salary_range_max'])}"
    )

    rules = [
        f"Full-time roles: answer the larger of the posted range's midpoint and "
        f"{floor} {currency}, capped at the posted maximum. With no posted range, "
        f"answer {floor} {currency}.",

        f"Asked for a range when none is posted: {fallback_range} {currency}.",

        f"Hourly roles: the posted range's midpoint, otherwise {hourly_floor}/hour "
        f"({floor} divided by {WORK_HOURS_PER_YEAR} hours).",
    ]
    return "\n".join(f"  - {rule}" for rule in rules)


def _describe_login_rule(personal: dict) -> str:
    """Return how to get past a login wall; the template puts this after "Otherwise"."""
    if not personal["password"]:
        return "end with `RESULT:LOGIN_ISSUE`: no account password is configured"

    return (
        f"sign in, or create an account, with `{personal['email']}` and the "
        f"password `{personal['password']}`. When both fail, end with "
        f"`RESULT:LOGIN_ISSUE`"
    )


def _list_answers(profile: dict) -> str:
    """List Adam's answers as Markdown, with one heading per profile section.

    Blank answers are skipped, so the agent treats those questions as
    unanswered. The account password is skipped because the login rule
    already carries it.
    """
    sections = []

    for section, answers in profile.items():
        if section in SETTINGS_SECTIONS:
            continue

        lines = [f"### {_label(section)}"]
        for key, answer in answers.items():
            is_password = section == "personal" and key == "password"
            if is_password or answer in ("", [], None):
                continue

            shown = ", ".join(answer) if isinstance(answer, list) else answer
            lines.append(f"- {_label(key)}: {shown}")

        sections.append("\n".join(lines))

    return "\n\n".join(sections)


def _label(key: str) -> str:
    """Turn a profile key into a label: ``linkedin_url`` becomes ``Linkedin URL``."""
    words = [word.upper() if word in ACRONYMS else word for word in key.split("_")]
    label = " ".join(words)
    return label[0].upper() + label[1:]


def _dollars(amount: int) -> str:
    """Format a whole-dollar amount: ``150000`` becomes ``$150,000``."""
    return f"${amount:,}"


def _read_pdf_text(pdf: Path) -> str:
    """Return a PDF's text as an applicant tracking system would read it.

    Uses ``pdftotext`` from Poppler; ``-layout`` keeps dates aligned with
    the lines they belong to.
    """
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf), "-"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()
