"""Where the harness keeps its files, and how it reads Adam's profile."""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# Adam's answers. Gitignored; profile.example.json documents the shape.
PROFILE_PATH = REPO_ROOT / "profile.json"

# The Chrome user-data directory the agent applies from; it keeps Adam's job-site logins.
CHROME_PROFILE = Path.home() / "Library/Application Support/CuaDriver/BrowserProfiles/jobs"

# Runtime state lives outside the repo: Pi loads AGENTS.md from every parent of its working directory.
STATE_DIR = Path.home() / ".jobs"


def load_profile(path: Path = PROFILE_PATH) -> dict:
    """Read a profile file into a dict."""
    return json.loads(path.read_text(encoding="utf-8"))
