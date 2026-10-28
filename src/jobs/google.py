"""Google OAuth and API calls for the harness's own API clients (Sheets, and Gmail cleanup).

Both use the Desktop OAuth client in ``.mcp/gmail-oauth.json``, each with its own refresh token,
so each holds only the scopes it needs.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path

from jobs.config import REPO_ROOT

CLIENT = REPO_ROOT / ".mcp/gmail-oauth.json"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# Google's per-user quotas reset each minute. Throttled calls were not carried out, so they are
# retried after these waits, which span more than a minute.
RETRY_WAITS = [2, 4, 8, 16, 32]

# Access tokens by refresh-token file: each is valid for an hour.
_tokens: dict[Path, tuple[str, float]] = {}


def client() -> dict:
    return json.loads(CLIENT.read_text())["installed"]


def token_request(**fields: str) -> dict:
    """Send ``fields`` to Google's token endpoint along with the OAuth client's credentials, and return its reply."""
    installed = client()
    form = urllib.parse.urlencode({
        "client_id": installed["client_id"],
        "client_secret": installed["client_secret"],
        **fields,
    }).encode()

    with urllib.request.urlopen(TOKEN_URL, form, timeout=30) as response:
        return json.load(response)


def access_token(token_path: Path) -> str:
    """Return an access token for the refresh token in ``token_path``, exchanging it again only when it is about to expire."""
    value, expires = _tokens.get(token_path, ("", 0.0))
    if time.monotonic() < expires:
        return value

    refresh_token = json.loads(token_path.read_text())["refresh_token"]
    reply = token_request(refresh_token=refresh_token, grant_type="refresh_token")

    _tokens[token_path] = (reply["access_token"], time.monotonic() + reply.get("expires_in", 3600) - 300)
    return reply["access_token"]


def call(url: str, token_path: Path, *, method: str = "GET", body: dict | None = None,
         retryable: Callable[[urllib.error.HTTPError], bool]) -> dict:
    """Call a Google API with the refresh token in ``token_path`` and return its JSON reply.

    An error that ``retryable`` accepts is retried after each of ``RETRY_WAITS`` in turn, or after
    the reply's ``Retry-After``. Any other error, and the last one, is raised.
    """
    data, content_type = None, {}
    if body is not None:
        data, content_type = json.dumps(body).encode(), {"Content-Type": "application/json"}
    elif method == "POST":
        data = b""  # Google rejects a POST without a Content-Length, even one with nothing to send

    for wait in [*RETRY_WAITS, None]:
        headers = {"Authorization": f"Bearer {access_token(token_path)}", **content_type}
        request = urllib.request.Request(url, method=method, data=data, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if not retryable(error) or wait is None:
                raise

            time.sleep(int(error.headers.get("Retry-After") or wait))
