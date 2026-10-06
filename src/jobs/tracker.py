"""The application tracker: a Google Sheet with ``Apps``, ``Failed``, and ``Logins`` tabs.

``Apps`` lists submitted applications. ``Failed`` holds the latest failure of each job
that has not succeeded, one row per URL. ``Logins`` lists the sites where apply agents
used or created an account for Adam. Every such account uses the profile's email and
password, so the Sheet never holds a password.
"""

import re
from datetime import date, datetime
from urllib.parse import parse_qs, urlparse

from jobs.config import STATE_DIR
from jobs.lock import locked
from jobs.sheets import Sheet

APPLIED, FAILED, LOGINS = "Apps", "Failed", "Logins"

# Failures that settle a job: retrying cannot change them, or risks submitting twice.
FINAL_REASONS = {
    "already_applied", "excluded_company", "banned_site", "expired", "not_eligible", "sso_required", "sensitive_request",
    "unsafe_permissions", "not_a_job_application", "email_only", "unconfirmed",
}


class Tracker:
    def __init__(self, sheet_id: str):
        self.sheet = Sheet(sheet_id)

    def skip_reason(self, url: str) -> str | None:
        """Return why ``url`` must not be applied to again, or ``None``."""
        if self.sheet.find(APPLIED, "URL", url)[0]:
            return "already_applied"

        reason = self.sheet.find(FAILED, "URL", url)[1].get("Reason")
        return reason if reason in FINAL_REASONS else None

    def earlier_applications(self, url: str) -> list[dict]:
        """Return the ``Apps`` rows for the employer at ``url``: those whose company name appears in the URL,
        or whose own URL went through the same application site.

        Comparing letters alone finds "Akuna Capital" in job-boards.greenhouse.io/akunacapital and "IMC" in
        job-boards.eu.greenhouse.io/imc. Names shorter than three letters are skipped: "X" would match every
        Workday URL's "XMLNAME". A site that hides the employer's name, such as Hudson River Trading's
        Greenhouse board "wehrtyou", matches only rows that recorded a URL there, and older rows have none,
        so an empty list proves nothing.
        """
        address, site = _letters(url), _site(url)
        return [row for row in self.sheet.rows(APPLIED)
                if (len(company := _letters(row.get("jobs", ""))) >= 3 and company in address)
                or (site is not None and _site(row.get("URL", "")) == site)]

    def record(self, url: str, result, run_id: str) -> None:
        """Record a live run's result: a success in ``Apps``, a failure in ``Failed``."""
        # Workers share the Failed tab's row numbers, so they edit it one at a time.
        with locked(STATE_DIR / "tracker.lock"):
            number, failure = self.sheet.find(FAILED, "URL", url)

            if result.status == "applied":
                # Apps names its company column "jobs"; Failed still uses "Company".
                self.sheet.append(APPLIED, {"jobs": result.company, "Role": result.role,
                                            "Applied": date.today().isoformat(), "Salary": result.salary, "URL": url})
                if number:
                    self.sheet.delete(FAILED, number)
                return

            row = {"URL": url, "Company": result.company, "Role": result.role, "Reason": result.reason,
                   "Explanation": result.explanation, "Attempts": int(failure.get("Attempts") or 0) + 1,
                   "Last tried": f"{datetime.now():%Y-%m-%d %H:%M}", "Run": run_id}
            if number:
                self.sheet.update(FAILED, number, row)
            else:
                self.sheet.append(FAILED, row)

    def record_account(self, site: str, email: str) -> None:
        """Note that an agent used Adam's account on ``site`` today, listing the site the first time."""
        today = date.today().isoformat()

        with locked(STATE_DIR / "tracker.lock"):
            number, account = self.sheet.find(LOGINS, "Site", site)

            if number:
                self.sheet.update(LOGINS, number, {**account, "Last used": today})
            else:
                self.sheet.append(LOGINS, {"Site": site, "Email": email, "First used": today, "Last used": today})


def _letters(text: str) -> str:
    return re.sub(r"[^a-z]", "", text.lower())


# Application sites that serve many employers from one host. Greenhouse and Ashby boards are told apart by
# path; for the others, a host would match other employers' applications, so they name no site.
SHARED_HOSTS = ("smartrecruiters.com", "workable.com", "rippling.com", "jobvite.com", "lever.co", "dover.com",
                "wellfound.com", "linkedin.com")


def _site(url: str) -> str | None:
    """Name the employer's application site at ``url``: its board on Greenhouse or Ashby, which host many
    employers, otherwise its host. ``None`` when the URL does not show it."""
    parts = urlparse(url)
    host = (parts.hostname or "").removeprefix("www.")
    if host.endswith(SHARED_HOSTS):
        return None

    for ats in ("greenhouse.io", "ashbyhq.com"):
        if host.endswith(ats):
            # job-boards.greenhouse.io/<board>/jobs/<id>, .../embed/job_app?for=<board>, jobs.ashbyhq.com/<org>/<id>
            board = parse_qs(parts.query).get("for", [parts.path.strip("/").split("/")[0]])[0].lower()
            return None if board in ("", "embed") else f"{ats}/{board}"

    return host or None
