import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { SESSION_WORKERS } from "../shared/config.ts";
import { onSite } from "../shared/sites.ts";
import { claimJob, lockWorker, workersDir } from "./claims.ts";
import { prepareWorker } from "./profile.ts";

const RETRY_SECONDS = 5;

export const io = { prepareWorker, sleep: (seconds: number) => sleep(seconds * 1000) };

export type WorkerOptions = { first?: number; waitForUrl?: boolean };

export async function withWorker<T>(
  url: string,
  count: number,
  { first = 0, waitForUrl = false }: WorkerOptions,
  body: (directory: string | null) => Promise<T>,
): Promise<T> {
  while (true) {
    for (const n of candidates(url, count, first)) {
      const directory = join(workersDir(), String(n));
      const lock = lockWorker(directory);
      if (lock === null) {
        continue;
      }

      try {
        const claim = await claimJob(directory, url);
        if (claim === "same employer" || (claim === "duplicate" && waitForUrl)) {
          break;
        }
        if (claim === "duplicate") {
          return await body(null);
        }

        await io.prepareWorker(directory);
        return await body(directory);
      } finally {
        lock.release();
      }
    }

    await io.sleep(RETRY_SECONDS);
  }
}

export function candidates(url: string, count: number, first: number, sessionWorkers = SESSION_WORKERS): number[] {
  for (const [n, sites] of sessionWorkers) {
    if (onSite(url, sites)) {
      return [n];
    }
  }
  return Array.from({ length: count }, (_, i) => first + i).filter((n) => !sessionWorkers.has(n));
}
