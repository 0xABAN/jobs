import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";

const SQLITE_BUSY = 5;
const POLL_MS = 100;

export type Lock = { release(): void };

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

export async function withLock<T>(path: string, body: () => Promise<T> | T): Promise<T> {
  let lock: Lock | null;
  while (!(lock = tryLock(path))) {
    await sleep(POLL_MS);
  }

  try {
    return await body();
  } finally {
    lock.release();
  }
}

export function isLocked(path: string): boolean {
  const lock = tryLock(path);
  lock?.release();
  return lock === null;
}
