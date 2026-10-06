"""A minimal Google Sheets client whose rows are dicts keyed by each tab's header row.

Callers never depend on column order: that lives in the Sheet. Credentials are the
Sheets MCP server's: the Desktop OAuth client and its refresh token in ``.mcp/``.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from jobs.config import REPO_ROOT
from jobs.google import access_token

TOKEN = REPO_ROOT / ".mcp/google-sheets-token.json"

# Sheets allows about 60 reads a minute per user, and 20 workers starting at once exceed it.
# Throttled calls (429) were not carried out, so they are retried after these waits, which span
# a full minute. Server errors are retried only for reads: a write may have gone through.
RETRY_WAITS = [2, 4, 8, 16, 32]


class Sheet:
    def __init__(self, sheet_id: str):
        self.url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}"

    def rows(self, tab: str) -> list[dict]:
        """Return every row of ``tab`` below the header, as dicts keyed by the header row."""
        header, *rows = self._call("GET", f"/values/{_range(tab)}").get("values", [[]])
        return [dict(zip(header, cells)) for cells in rows]

    def find(self, tab: str, column: str, value: str) -> tuple[int | None, dict]:
        """Return the row number and contents of the first row in ``tab`` whose ``column`` is ``value``, or ``(None, {})``."""
        for index, row in enumerate(self.rows(tab)):
            if row.get(column) == value:
                return index + 2, row  # row 1 is the header

        return None, {}

    def append(self, tab: str, row: dict) -> None:
        self._call("POST", f"/values/{_range(tab)}:append?valueInputOption=RAW", {"values": [self._cells(tab, row)]})

    def update(self, tab: str, number: int, row: dict) -> None:
        self._call("PUT", f"/values/{_range(f'{tab}!A{number}')}?valueInputOption=RAW", {"values": [self._cells(tab, row)]})

    def delete(self, tab: str, number: int) -> None:
        sheets = self._call("GET", "?fields=sheets.properties(sheetId,title)")["sheets"]
        sheet_id = next(s["properties"]["sheetId"] for s in sheets if s["properties"]["title"] == tab)
        rows = {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": number - 1, "endIndex": number}
        self._call("POST", ":batchUpdate", {"requests": [{"deleteDimension": {"range": rows}}]})

    def _cells(self, tab: str, row: dict) -> list:
        """Order ``row``'s values by ``tab``'s header row."""
        header = self._call("GET", f"/values/{_range(f'{tab}!1:1')}")["values"][0]
        return ["" if row.get(column) is None else row[column] for column in header]

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        for wait in [*RETRY_WAITS, None]:
            request = urllib.request.Request(
                self.url + path,
                method=method,
                data=json.dumps(body).encode() if body else None,
                headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    return json.load(response)
            except urllib.error.HTTPError as error:
                retryable = error.code == 429 or (method == "GET" and error.code in (500, 502, 503))
                if not retryable or wait is None:
                    raise

                time.sleep(int(error.headers.get("Retry-After") or wait))


def _range(a1: str) -> str:
    return urllib.parse.quote(a1, safe="")


def _access_token() -> str:
    return access_token(TOKEN)
