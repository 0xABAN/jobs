import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { statePath } from "../shared/config.ts";
import { isLocked, tryLock, withLock } from "../shared/lock.ts";
import type { Lock } from "../shared/lock.ts";
import { atsBoard } from "../shared/sites.ts";

export type Claim = "claimed" | "duplicate" | "same employer";

export function workersDir(): string {
  return statePath("workers");
}

export function lockWorker(directory: string): Lock | null {
  return tryLock(lockFile(directory));
}

export async function claimJob(directory: string, url: string): Promise<Claim> {
  writeFileSync(jobFile(directory), "");

  return withLock(join(workersDir(), "claims.lock"), () => {
    const others = running();
    if (others.includes(url)) {
      return "duplicate";
    }
    if (others.some((other) => sharesCodes(url, other))) {
      return "same employer";
    }

    writeFileSync(jobFile(directory), url);
    return "claimed";
  });
}

export function running(): string[] {
  if (!existsSync(workersDir())) {
    return [];
  }

  return readdirSync(workersDir())
    .sort()
    .map((name) => join(workersDir(), name))
    .filter((directory) => existsSync(lockFile(directory)) && isLocked(lockFile(directory)))
    .map((directory) => (existsSync(jobFile(directory)) ? readFileSync(jobFile(directory), "utf8") : ""));
}

export function sharesCodes(url: string, other: string): boolean {
  const boards = [greenhouseBoard(url), greenhouseBoard(other)];
  if (boards.includes(null)) {
    return false;
  }
  return boards[0] === boards[1] || boards.includes("");
}

export function greenhouseBoard(url: string): string | null {
  const [ats, board] = atsBoard(url) ?? [null, null];
  return ats === "greenhouse.io" ? board : null;
}

function lockFile(directory: string): string {
  return join(directory, "job.lock");
}

function jobFile(directory: string): string {
  return join(directory, "job");
}
