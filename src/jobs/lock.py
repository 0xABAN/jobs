"""Cross-process locks on files."""

import fcntl
from contextlib import contextmanager
from pathlib import Path


@contextmanager
def locked(path: Path, *, wait: bool = True):
    """Hold an exclusive lock on ``path`` and yield the open file, or ``None`` when it is taken and ``wait`` is false.

    The lock is released when the block exits, and by the operating system if the process dies.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+", encoding="utf-8") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | (0 if wait else fcntl.LOCK_NB))
        except BlockingIOError:
            yield None
            return

        yield file
