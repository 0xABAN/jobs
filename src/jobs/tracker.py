"""The application tracker: a Google Sheet with an ``Apps`` tab and a ``Failed`` tab.

``Apps`` lists submitted applications. ``Failed`` holds the latest failure of each job
that has not succeeded, one row per URL. Rows are dicts keyed by each tab's header row,
so column order lives in the Sheet. Credentials are the Sheets MCP server's.
"""

import json
import urllib.parse
import urllib.request
from datetime import date, datetime

from jobs.config import REPO_ROOT, STATE_DIR
from jobs.lock import locked

APPLIED, FAILED = "Apps", "Failed"

# Failures that settle a job: retrying cannot change them, or risks submitting twice.
FINAL_REASONS = {
    "already_applied", "excluded_company", "expired", "not_eligible", "sso_required", "sensitive_request",
    "unsafe_permissions", "not_a_job_application", "email_only", "unconfirmed",
}

CLIENT = REPO_ROOT / ".mcp/gmail-oauth.json"
TOKEN = REPO_ROOT / ".mcp/google-sheets-token.json"


class Tracker:
    def __init__(self, sheet_id: str):
        self.url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"

    def skip_reason(self, url: str) -> str | None:
        """Return why ``url`` must not be applied to again, or ``None``."""
        if self._find(APPLIED, url)[0]:
            return "already_applied"

        reason = self._find(FAILED, url)[1].get("Reason")
        return reason if reason in FINAL_REASONS else None

    def record(self, url: str, result, run_id: str) -> None:
        """Record a live run's result: a success in ``Apps``, a failure in ``Failed``."""
        # Workers share the Failed tab's row numbers, so they edit it one at a time.
        with locked(STATE_DIR / "tracker.lock"):
            number, failure = self._find(FAILED, url)

            if result.status == "applied":
                today = date.today().isoformat()
                self._append(APPLIED, {"Company": result.company, "Role": result.role, "Applied": today,
                                       "Salary": result.salary, "URL": url})
                if number:
                    self._delete(FAILED, number)
                return

            row = {"URL": url, "Company": result.company, "Role": result.role, "Reason": result.reason,
                   "Explanation": result.explanation, "Attempts": int(failure.get("Attempts") or 0) + 1,
                   "Last tried": f"{datetime.now():%Y-%m-%d %H:%M}", "Run": run_id}
            if number:
                self._call("PUT", f"/values/{_range(f'{FAILED}!A{number}')}?valueInputOption=RAW",
                           {"values": [self._cells(FAILED, row)]})
            else:
                self._append(FAILED, row)

    def _find(self, tab: str, url: str) -> tuple[int | None, dict]:
        """Return the sheet row number and contents of ``url``'s row in ``tab``, or ``(None, {})``."""
        header, *rows = self._call("GET", f"/values/{_range(tab)}").get("values", [[]])
        for index, cells in enumerate(rows):
            row = dict(zip(header, cells))
            if row.get("URL") == url:
                return index + 2, row  # row 1 is the header

        return None, {}

    def _append(self, tab: str, row: dict) -> None:
        self._call("POST", f"/values/{_range(tab)}:append?valueInputOption=RAW", {"values": [self._cells(tab, row)]})

    def _delete(self, tab: str, number: int) -> None:
        sheets = self._call("GET", "?fields=sheets.properties(sheetId,title)")["sheets"]
        sheet_id = next(s["properties"]["sheetId"] for s in sheets if s["properties"]["title"] == tab)
        rows = {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": number - 1, "endIndex": number}
        self._call("POST", ":batchUpdate", {"requests": [{"deleteDimension": {"range": rows}}]})

    def _cells(self, tab: str, row: dict) -> list:
        """Order ``row``'s values by ``tab``'s header row."""
        header = self._call("GET", f"/values/{_range(f'{tab}!1:1')}")["values"][0]
        return ["" if row.get(column) is None else row[column] for column in header]

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        request = urllib.request.Request(
            self.url + path,
            method=method,
            data=json.dumps(body).encode() if body else None,
            headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)


def _range(a1: str) -> str:
    return urllib.parse.quote(a1, safe="")


def _access_token() -> str:
    """Exchange the Sheets refresh token for an access token (valid for an hour)."""
    client = json.loads(CLIENT.read_text())["installed"]
    form = urllib.parse.urlencode({
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "refresh_token": json.loads(TOKEN.read_text())["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen("https://oauth2.googleapis.com/token", form, timeout=30) as response:
        return json.load(response)["access_token"]
