"""Run the Chrome that an apply agent drives through CUA.

The harness launches Chrome itself, as ApplyPilot does, so it chooses the
flags: CUA's own launch leaves Chrome throttling hidden windows. CUA then
attaches to this process, which its ``--grant existing-profile`` allows.
"""

import os
import signal
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

FLAGS = [
    "--remote-debugging-port=0",  # any free port; CUA finds it from the pid
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    # Chrome slows pages in covered or background windows; the agent works in one.
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
]


@contextmanager
def chrome(profile: Path, url: str):
    """Open ``url`` in a background Chrome on ``profile``, yield its pid, and quit it afterwards.

    Raises ``RuntimeError`` when another Chrome already uses the profile or
    this one does not start.
    """
    if owner := _owner(profile):
        raise RuntimeError(f"Chrome (pid {owner}) is already using {profile}; quit it first")

    # Chrome writes this file once its debugger listens; a stale copy would fake readiness.
    (profile / "DevToolsActivePort").unlink(missing_ok=True)
    previous_app = _frontmost_app()

    # `-g` launches in the background; `-n` starts an instance apart from personal Chrome.
    subprocess.run(
        ["open", "-g", "-n", "-a", "Google Chrome", "--args", f"--user-data-dir={profile}", *FLAGS, url],
        check=True,
    )
    if not _wait(lambda: (profile / "DevToolsActivePort").exists() and _owner(profile), seconds=30):
        raise RuntimeError(f"Chrome did not start on {profile}")

    pid = _owner(profile)
    try:
        # Chrome still takes focus when its window opens; hand it back to whatever Adam was using.
        if _wait(lambda: _frontmost_app() == pid, seconds=5):
            _appkit(f"$.NSRunningApplication.runningApplicationWithProcessIdentifier({previous_app}).activateWithOptions(0)")

        yield pid
    finally:
        os.kill(pid, signal.SIGTERM)  # Chrome shuts down cleanly on SIGTERM
        _wait(lambda: not _alive(pid), seconds=10)


def _owner(profile: Path) -> int | None:
    """Return the pid of the Chrome using ``profile``, read from its ``SingletonLock`` symlink ("<host>-<pid>")."""
    try:
        pid = int(os.readlink(profile / "SingletonLock").rsplit("-", 1)[1])
    except FileNotFoundError:
        return None

    return pid if _alive(pid) else None


def _frontmost_app() -> int:
    return int(_appkit("$.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier"))


def _appkit(expression: str) -> str:
    """Evaluate an AppKit expression through JavaScript for Automation and return its output."""
    command = ["osascript", "-l", "JavaScript", "-e", f"ObjC.import('AppKit'); {expression}"]
    return subprocess.run(command, capture_output=True, text=True, check=True).stdout.strip()


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _wait(condition, *, seconds: float) -> bool:
    """Poll ``condition`` until it holds or ``seconds`` pass; return whether it held."""
    deadline = time.monotonic() + seconds
    while not condition():
        if time.monotonic() > deadline:
            return False
        time.sleep(0.25)
    return True
