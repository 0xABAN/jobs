"""Google OAuth for the harness's own API clients (Sheets, and Gmail cleanup).

Both use the Desktop OAuth client in ``.mcp/gmail-oauth.json``, each with its own refresh token,
so each holds only the scopes it needs.
"""

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

from jobs.config import REPO_ROOT

CLIENT = REPO_ROOT / ".mcp/gmail-oauth.json"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# Access tokens by refresh-token file: each is valid for an hour.
_tokens: dict[Path, tuple[str, float]] = {}


def client() -> dict:
    return json.loads(CLIENT.read_text())["installed"]


def access_token(token_path: Path) -> str:
    """Return an access token for the refresh token in ``token_path``, exchanging it again only when it is about to expire."""
    value, expires = _tokens.get(token_path, ("", 0.0))
    if time.monotonic() < expires:
        return value

    form = urllib.parse.urlencode({
        "client_id": client()["client_id"],
        "client_secret": client()["client_secret"],
        "refresh_token": json.loads(token_path.read_text())["refresh_token"],
        "grant_type": "refresh_token",
    }).encode()
    with urllib.request.urlopen(TOKEN_URL, form, timeout=30) as response:
        reply = json.load(response)

    _tokens[token_path] = (reply["access_token"], time.monotonic() + reply.get("expires_in", 3600) - 300)
    return reply["access_token"]
