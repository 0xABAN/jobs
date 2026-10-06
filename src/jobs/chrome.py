"""Run the Chrome that an apply agent drives through CUA.

The harness launches Chrome itself, as ApplyPilot does, so it chooses the
flags: CUA's own launch leaves Chrome throttling hidden windows. CUA then
attaches to this process, which its ``--grant existing-profile`` allows.
"""

import json
import os
import shutil
import signal
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path

from websockets.sync.client import connect

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

# Caches Chrome rebuilds on demand. They grow each worker's profile by ~300 MB, and 20 workers
# share a nearly full disk, so they are deleted after every run. Logins live in cookies and site
# storage, which stay.
CACHES = ["Default/Cache", "Default/Code Cache", "Default/Service Worker/CacheStorage",
          "Default/Service Worker/ScriptCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "component_crx_cache"]


@contextmanager
def chrome(profile: Path, url: str):
    """Open ``url`` in a background Chrome on ``profile``, yield its pid, and quit it afterwards, dropping its caches."""
    pid = launch(profile, url)
    try:
        yield pid
    finally:
        close(pid)
        if not _alive(pid):  # never delete files under a Chrome that is still running
            for cache in CACHES:
                shutil.rmtree(profile / cache, ignore_errors=True)


def launch(profile: Path, url: str) -> int:
    """Open ``url`` in a background Chrome on ``profile`` and return its pid.

    Raises ``RuntimeError`` when another Chrome already uses the profile or
    this one does not start.
    """
    if owner := _owner(profile):
        raise RuntimeError(f"Chrome (pid {owner}) is already using {profile}; quit it first")

    # Chrome writes this file once its debugger listens; a stale copy would fake readiness.
    (profile / "DevToolsActivePort").unlink(missing_ok=True)

    # Chrome takes focus from Adam's app when it opens its startup window, even when `open -g`
    # launches it in the background. So it starts windowless, and the job opens in a background
    # window, which leaves focus alone. `-n` starts an instance apart from personal Chrome.
    subprocess.run(
        ["open", "-g", "-n", "-a", "Google Chrome", "--args", f"--user-data-dir={profile}", "--no-startup-window",
         *FLAGS],
        check=True,
    )
    if not _wait(lambda: (profile / "DevToolsActivePort").exists() and _owner(profile), seconds=30):
        raise RuntimeError(f"Chrome did not start on {profile}")

    pid = _owner(profile)
    try:
        _open_background_window(profile, url)
    except BaseException:
        close(pid)
        raise

    return pid


def devtools_port(profile: Path) -> int:
    """Return the DevTools port of the Chrome running on ``profile``; Chrome picked it at launch."""
    return int((profile / "DevToolsActivePort").read_text().split()[0])


def close(pid: int) -> None:
    os.kill(pid, signal.SIGTERM)  # Chrome shuts down cleanly on SIGTERM
    _wait(lambda: not _alive(pid), seconds=10)


def _owner(profile: Path) -> int | None:
    """Return the pid of the Chrome using ``profile``, read from its ``SingletonLock`` symlink ("<host>-<pid>")."""
    try:
        pid = int(os.readlink(profile / "SingletonLock").rsplit("-", 1)[1])
    except FileNotFoundError:
        return None

    return pid if _alive(pid) else None


def _open_background_window(profile: Path, url: str) -> None:
    """Open ``url`` in a new window of the Chrome on ``profile`` without activating Chrome.

    Uses the browser's DevTools endpoint, which Chrome names in ``DevToolsActivePort``'s second line.
    """
    port, path = (profile / "DevToolsActivePort").read_text().split()[:2]
    request = {"id": 1, "method": "Target.createTarget", "params": {"url": url, "newWindow": True, "background": True}}

    with connect(f"ws://127.0.0.1:{port}{path}", max_size=None) as socket:
        socket.send(json.dumps(request))
        while (reply := json.loads(socket.recv(timeout=30))).get("id") != 1:
            pass  # an event, not our reply

    if "error" in reply:
        raise RuntimeError(f"Chrome could not open {url}: {reply['error']['message']}")


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
