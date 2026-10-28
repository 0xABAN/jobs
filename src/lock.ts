/**
 * Cross-process locks on files, which the operating system releases if their process dies.
 *
 * Node has no flock(), so a lock is an exclusive transaction on an SQLite database at the lock's
 * path. SQLite holds a POSIX lock on the file, which the OS drops along with a crashed process, and
 * it refuses a second connection to the same file even from the same process. Waiting polls, because
 * SQLite's own busy wait would block the event loop that every job in a process shares.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const SQLITE_BUSY = 5;

/** A held lock. */
export type Lock = { release(): void };

/** Take the lock at `path`, or return null when another holder has it. */
export function tryLock(path: string): Lock | null {
  mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);

  try {
    database.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    database.close();
    if ((error as { errcode?: number }).errcode === SQLITE_BUSY) {
      return null;
    }
    throw error;
  }

  return {
    release() {
      database.exec("ROLLBACK");
      database.close();
    },
  };
}

/** Wait for the lock at `path`, run `body` while holding it, and release it. */
export async function withLock<T>(path: string, body: () => Promise<T> | T): Promise<T> {
  let lock: Lock | null;
  while (!(lock = tryLock(path))) {
    await sleep(100);
  }

  try {
    return await body();
  } finally {
    lock.release();
  }
}

/** Return whether another holder has the lock at `path`. */
export function isLocked(path: string): boolean {
  const lock = tryLock(path);
  lock?.release();
  return lock === null;
}
