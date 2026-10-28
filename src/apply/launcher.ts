/**
 * Apply to one job: claim a worker, open the job in its Chrome, run a headless Pi agent, and record the result.
 *
 * Each run leaves `~/.jobs/runs/<run id>/` with the prompt, the agent's JSONL
 * transcript, and `result.json`, which also times the run's phases for `jobs
 * timeline`. The prompt embeds Adam's profile, so the directory is private to his
 * account. After `LOGS_KEPT_HOURS` only `result.json` remains. Live runs are also
 * recorded in the tracker, and so is any account an agent used, in dry runs too.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { devtoolsPort, withChrome } from "../chrome.ts";
import { emailFor, env, loadProfile, paths, REPO_ROOT } from "../config.ts";
import { stamp } from "../dates.ts";
import * as pi from "../pi.ts";
import { banned } from "../sites.ts";
import { Tracker } from "../tracker.ts";
import { renderPrompt } from "./prompt.ts";
import { parseResult, result } from "./result.ts";
import type { Result } from "./result.ts";
import { withWorker } from "./workers.ts";

// Transcripts reach about 100 MB per run, mostly raw browser results, and prompts hold Adam's
// password, so each run's logs except result.json are deleted after this long.
const LOGS_KEPT_HOURS = 3;

// Pinned, so a Playwright release cannot change the agent's tools between runs.
const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83";

/** Collaborators that tests replace. */
export const io = { loadProfile, Tracker, withWorker, withChrome, devtoolsPort, connectPlaywright, env, runAgent: pi.run };

export function runsDir(): string {
  return join(paths.state, "runs");
}

export type ApplyOptions = {
  dryRun: boolean;
  timeoutMinutes: number;
  workers: number;
  firstWorker?: number;
  model?: string;
};

/**
 * Apply to the job at `url` on one of `workers` workers from `firstWorker` on, waiting for a free one,
 * and return how it ended.
 */
export async function apply(url: string, { dryRun, timeoutMinutes, workers, firstWorker = 0, model = pi.MODEL }: ApplyOptions):
  Promise<Result> {
  if (banned(url)) {
    return result("skipped", "banned_site", "The harness never applies on this site.");
  }

  pruneLogs();

  const profile = io.loadProfile();
  const tracker = new io.Tracker(profile.tracker.sheet_id);
  const stopwatch = new Stopwatch();

  return io.withWorker(url, workers, { first: firstWorker, waitForUrl: dryRun }, async (directory) => {
    stopwatch.lap("worker");
    if (directory === null) {
      return result("skipped", "in_progress", "Another worker is applying to this job.");
    }

    const reason = await tracker.skipReason(url);
    if (reason) {
      return result("skipped", reason, "The tracker already settles this job.");
    }
    const earlierApplications = await tracker.earlierApplications(url);
    stopwatch.lap("check");

    const runId = `${stamp()}-${basename(directory)}`;
    const runDir = join(runsDir(), runId);
    const chromeProfile = join(directory, "chrome");

    const outcome = await io.withChrome(chromeProfile, url, async (chromePid) => {
      stopwatch.lap("chrome");
      io.connectPlaywright(directory, io.devtoolsPort(chromeProfile));
      mkdirSync(runDir, { recursive: true, mode: 0o700 });
      const prompt = join(runDir, "prompt.md");
      writeFileSync(prompt, renderPrompt(url, {
        dryRun, profile, today: new Date(), chromePid, capsolverKey: io.env("CAPSOLVER_API_KEY"), earlierApplications,
      }));

      let outcome: Result;
      try {
        outcome = parseResult(await io.runAgent(prompt, { cwd: directory, logDir: runDir, timeoutMinutes, model }));
      } catch (error) {
        if (!(error instanceof pi.AgentTimeout)) {
          throw error;
        }
        outcome = result("failed", "timeout", `The agent did not finish within ${timeoutMinutes} minutes.`);
      }
      stopwatch.lap("agent");
      return outcome;
    });
    stopwatch.lap("quit");

    try {
      // Record while still holding the worker, so no other worker starts this URL in between.
      if (!dryRun) {
        await tracker.record(url, outcome, runId);
      }

      // Dry runs sign in and create accounts for real, so their accounts are recorded too.
      if (outcome.account) {
        await tracker.recordAccount(outcome.account, emailFor(profile, outcome.company));
      }
    } finally {
      stopwatch.lap("record");
      const record = { url, dry_run: dryRun, ...outcome, phases: stopwatch.laps };
      writeFileSync(join(runDir, "result.json"), JSON.stringify(record, null, 2) + "\n");
    }

    return outcome;
  });
}

/**
 * Give the worker's agent Gmail and Playwright, attached to this run's Chrome, and no other MCP server.
 *
 * The DevTools port changes with every Chrome launch, so each run writes the worker's MCP
 * config afresh from the repo's, which stays the shared source for Gmail's.
 */
export function connectPlaywright(directory: string, port: number, repoConfig = join(REPO_ROOT, ".pi/mcp.json")): void {
  const config = JSON.parse(readFileSync(repoConfig, "utf8"));

  // The agent needs only the browser and Gmail. Every extra server is another node process per
  // run, and with many workers running, slow MCP startup left agents without Playwright.
  config.mcpServers = {
    gmail: config.mcpServers.gmail,
    playwright: {
      command: "npx",
      // --prefer-offline uses npx's cached copy of the pinned version without asking the registry.
      args: ["-y", "--prefer-offline", PLAYWRIGHT_MCP, "--cdp-endpoint", `http://127.0.0.1:${port}`, "--snapshot-mode", "none"],
      exposure: "codemode",
      description: "Drive the job page in Adam's background jobs Chrome",
    },
  };

  const path = join(directory, ".pi/mcp.json");
  mkdirSync(join(directory, ".pi"), { recursive: true });
  rmSync(path, { force: true });  // older workers hold a symlink to the repo's config here; never write through it
  writeFileSync(path, JSON.stringify(config, null, 2));
}

/**
 * Delete every file but `result.json` from run directories, once untouched for `LOGS_KEPT_HOURS`.
 *
 * A running agent writes its transcript continuously, so a live run is never old enough.
 */
export function pruneLogs(): void {
  if (!existsSync(runsDir())) {
    return;
  }

  const cutoff = Date.now() - LOGS_KEPT_HOURS * 3_600_000;

  for (const run of readdirSync(runsDir(), { withFileTypes: true })) {
    if (!run.isDirectory()) {
      continue;
    }

    for (const name of readdirSync(join(runsDir(), run.name))) {
      if (name === "result.json") {
        continue;
      }

      // Parallel runs prune too, so another one may delete a file first.
      const log = join(runsDir(), run.name, name);
      try {
        if (statSync(log).mtimeMs < cutoff) {
          rmSync(log);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

/** Times the phases of a run in order: `lap(name)` ends the phase called `name`. */
class Stopwatch {
  laps: Record<string, number> = {};  // seconds per phase
  private last = performance.now();

  lap(name: string): void {
    const now = performance.now();
    this.laps[name] = Math.round((now - this.last) / 100) / 10;
    this.last = now;
  }
}
