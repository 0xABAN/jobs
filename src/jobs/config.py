"""Where the harness keeps its files, which sites it avoids, and how it reads Adam's profile."""

import json
import urllib.parse
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Adam's answers. Gitignored; profile.example.json documents the shape.
PROFILE_PATH = REPO_ROOT / "profile.json"

# The Chrome user-data directory the agent applies from; it keeps Adam's job-site logins.
CHROME_PROFILE = Path.home() / "Library/Application Support/CuaDriver/BrowserProfiles/jobs"

# Runtime state lives outside the repo: Pi loads AGENTS.md from every parent of its working directory.
STATE_DIR = Path.home() / ".jobs"

# Application sites the harness never applies on, with their subdomains. Lever guards its forms
# with an hCaptcha that CapSolver cannot solve.
BANNED_SITES = ("lever.co",)


def load_profile(path: Path = PROFILE_PATH) -> dict:
    """Read a profile file into a dict."""
    return json.loads(path.read_text(encoding="utf-8"))


def email_for(profile: dict, company: str | None) -> str:
    """Return the email Adam applies with at ``company``: his ``email_by_employer`` entry for it, else his main email.

    An entry matches when its key appears in the company's name, ignoring case, so "NVIDIA" covers "NVIDIA Corporation".
    """
    personal = profile["personal"]
    for employer, email in personal.get("email_by_employer", {}).items():
        if company and employer.lower() in company.lower():
            return email

    return personal["email"]


def banned(url: str) -> bool:
    """Return whether ``url`` is on one of the ``BANNED_SITES``."""
    host = urllib.parse.urlparse(url).hostname or ""
    return any(host == site or host.endswith("." + site) for site in BANNED_SITES)


def env(name: str) -> str:
    """Return a secret from the repo's gitignored ``.env`` file."""
    for line in (REPO_ROOT / ".env").read_text(encoding="utf-8").splitlines():
        key, _, value = line.partition("=")
        if key.strip() == name:
            return value.strip()

    raise KeyError(f"{name} is not set in .env")
