/**
 * Worker slots, so several applications run in parallel.
 *
 * Worker `n` owns `~/.jobs/workers/<n>/`: the directory its Pi agent runs in (outside the
 * repo, so no AGENTS.md reaches the agent), a copy of Adam's `jobs` Chrome profile in
 * `chrome/`, `job.lock`, and `job`, which names the URL it is applying to. Holding the lock is
 * owning the worker, across processes; the operating system releases it if the process dies.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { paths, SESSION_WORKERS } from "../config.ts";
import { isLocked, tryLock, withLock } from "../lock.ts";
import { atsBoard, onSite } from "../sites.ts";

// Profile files a copy does without: caches, and files that tie a profile to a running Chrome.
const NOT_COPIED = [/^Singleton/, /^RunningChromeVersion$/, /^DevToolsActivePort$/, /Cache/, /^Service Worker$/, /^Crashpad$/];

/** Collaborators that tests replace. */
export const io = { prepare, sleep: (seconds: number) => sleep(seconds * 1000) };

export function workersDir(): string {
  return join(paths.state, "workers");
}

type WorkerOptions = { first?: number; waitForUrl?: boolean };

/**
 * Wait for a free worker among the `count` from number `first` on, claim it for `url`, and run `body` in its directory.
 *
 * When another worker is already applying to `url`, runs `body` with null, or with `waitForUrl`
 * waits for that run to end. Dry runs wait, so parallel experiments can repeat the same postings.
 * While another worker applies to the same employer through Greenhouse, waits for it too.
 * A job on a site in `SESSION_WORKERS` runs only on the worker holding Adam's sign-in there,
 * and other jobs skip those workers.
 */
export async function withWorker<T>(url: string, count: number, { first = 0, waitForUrl = false }: WorkerOptions,
  body: (directory: string | null) => Promise<T>): Promise<T> {
  while (true) {
    for (const n of candidates(url, count, first)) {
      const directory = join(workersDir(), String(n));
      const lock = tryLock(join(directory, "job.lock"));
      if (lock === null) {
        continue;
      }

      try {
        const claim = await claimJob(directory, url);
        if (claim === "same employer") {
          break;  // wait for that run, then try again
        }

        if (claim === "duplicate") {
          if (waitForUrl) {
            break;
          }
          return await body(null);
        }

        await io.prepare(directory);
        return await body(directory);
      } finally {
        lock.release();
      }
    }

    await io.sleep(5);
  }
}

/** Return the numbers of the workers that may run `url`, in the order to try them. */
export function candidates(url: string, count: number, first: number, sessionWorkers = SESSION_WORKERS): number[] {
  for (const [n, sites] of sessionWorkers) {
    if (onSite(url, sites)) {
      return [n];
    }
  }

  return Array.from({ length: count }, (_, i) => first + i).filter((n) => !sessionWorkers.has(n));
}

/** Return the URLs that workers are applying to now. */
export function running(): string[] {
  if (!existsSync(workersDir())) {
    return [];
  }

  return readdirSync(workersDir()).sort()
    .map((name) => join(workersDir(), name))
    .filter((directory) => existsSync(join(directory, "job.lock")) && isLocked(join(directory, "job.lock")))
    .map((directory) => {
      // A worker claimed a moment ago has not written its job file yet: it has no URL so far.
      const job = join(directory, "job");
      return existsSync(job) ? readFileSync(job, "utf8") : "";
    });
}

/**
 * Write `url` into this worker's job file and return "claimed".
 *
 * Returns "duplicate" instead when another worker already has `url`, and "same employer" when
 * another worker is applying to the same employer through Greenhouse (see `sharesCodes`).
 */
async function claimJob(directory: string, url: string): Promise<"claimed" | "duplicate" | "same employer"> {
  const job = join(directory, "job");
  writeFileSync(job, "");  // forget this worker's previous job

  // Check and claim under one lock, so two workers never take the same URL.
  return withLock(join(workersDir(), "claims.lock"), () => {
    const others = running();
    if (others.includes(url)) {
      return "duplicate";
    }

    if (others.some((other) => sharesCodes(url, other))) {
      return "same employer";
    }

    writeFileSync(job, url);
    return "claimed";
  });
}

/**
 * Whether applications at both URLs would get Greenhouse security codes that cannot be told apart.
 *
 * Greenhouse emails each application its own code, under a subject that names only the employer,
 * so two applications to one employer at once can each type the other's code: Tower Research's
 * second application was rejected that way (run 20261005-222717-0). A URL that hides its board,
 * such as an embed with only a token, could be any employer's. A Greenhouse form on the
 * employer's own site, such as stripe.com, goes unrecognized.
 */
export function sharesCodes(url: string, other: string): boolean {
  const boards = [greenhouseBoard(url), greenhouseBoard(other)];
  if (boards.includes(null)) {
    return false;
  }

  return boards[0] === boards[1] || boards.includes("");
}

/** Return the Greenhouse board `url` applies through, "" when the URL does not show it, or null off Greenhouse. */
export function greenhouseBoard(url: string): string | null {
  const [ats, board] = atsBoard(url) ?? [null, null];
  return ats === "greenhouse.io" ? board : null;
}

/**
 * Give a worker, on first use, a copy of Adam's Chrome profile and its logins.
 *
 * Every time, it also turns off Chrome's offer to save passwords in that copy: the "Save
 * password?" bubble after a sign-up opens as a second window of the agent's Chrome, and
 * CUA then refuses key presses as ambiguous between the two windows.
 *
 * It also sets "Continue where you left off", the only setting under which Chrome keeps
 * session cookies across restarts. Apple's sign-in is a session cookie, and every run starts
 * a new Chrome, so without it Adam's sign-in on worker 5 was gone by the first run
 * (2026-10-10). Restoring opens no tabs, because `launch` starts Chrome windowless.
 */
export async function prepare(directory: string): Promise<void> {
  mkdirSync(directory, { recursive: true });

  const chrome = join(directory, "chrome");
  if (!existsSync(chrome)) {
    // Copy aside and rename, so an interrupted copy never passes for a finished one.
    const partial = join(directory, "chrome.partial");
    await rm(partial, { recursive: true, force: true });
    await cp(paths.chromeProfile, partial, {
      recursive: true,
      verbatimSymlinks: true,
      filter: (source) => !NOT_COPIED.some((pattern) => pattern.test(basename(source))),
    });
    renameSync(partial, chrome);
  }

  // Chrome reads its preferences at launch, and this worker's Chrome is not running yet.
  const preferencesPath = join(chrome, "Default/Preferences");
  const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
  preferences.credentials_enable_service = false;
  (preferences.profile ??= {}).password_manager_enabled = false;
  (preferences.session ??= {}).restore_on_startup = 1;  // 1: continue where you left off
  writeFileSync(preferencesPath, JSON.stringify(preferences));
}
