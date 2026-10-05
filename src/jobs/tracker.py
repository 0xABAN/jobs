"""The application tracker: a Google Sheet with ``Apps``, ``Failed``, and ``Logins`` tabs.

``Apps`` lists submitted applications. ``Failed`` holds the latest failure of each job
that has not succeeded, one row per URL. ``Logins`` lists the sites where apply agents
used or created an account for Adam. Every such account uses the profile's email and
password, so the Sheet never holds a password.
"""

from datetime import date, datetime

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

    def record(self, url: str, result, run_id: str) -> None:
        """Record a live run's result: a success in ``Apps``, a failure in ``Failed``."""
        # Workers share the Failed tab's row numbers, so they edit it one at a time.
        with locked(STATE_DIR / "tracker.lock"):
            number, failure = self.sheet.find(FAILED, "URL", url)

            if result.status == "applied":
                self.sheet.append(APPLIED, {"Company": result.company, "Role": result.role,
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
