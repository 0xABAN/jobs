import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { MODEL } from "../agent/settings.ts";
import { AgentTimeout, run as runAgent } from "../agent/pi.ts";
import { devtoolsPort, withChrome } from "../browser/chrome.ts";
import { pruneLogs, runsDir } from "../runs/directory.ts";
import { Stopwatch } from "../runs/stopwatch.ts";
import { emailFor, env, loadProfile } from "../shared/config.ts";
import type { Profile } from "../shared/config.ts";
import { runStamp } from "../shared/dates.ts";
import { banned } from "../shared/sites.ts";
import { Tracker } from "../tracker/tracker.ts";
import type { Application } from "../tracker/tracker.ts";
import { withWorker } from "../workers/pool.ts";
import { connectPlaywright } from "./playwright.ts";
import { renderPrompt } from "./prompt.ts";
import { parseResult, result } from "./result.ts";
import type { Result } from "./result.ts";

export const io = { loadProfile, Tracker, withWorker, withChrome, devtoolsPort, connectPlaywright, env, runAgent };

export type ApplyOptions = {
  dryRun: boolean;
  timeoutMinutes: number;
  workers: number;
  firstWorker?: number;
  model?: string;
};

type Run = { url: string; options: Required<ApplyOptions>; profile: Profile; tracker: Tracker; stopwatch: Stopwatch };

export async function apply(url: string, options: ApplyOptions): Promise<Result> {
  if (banned(url)) {
    return result("skipped", "banned_site", "The harness never applies on this site.");
  }
  pruneLogs();

  const profile = io.loadProfile();
  const run: Run = {
    url,
    options: { ...options, firstWorker: options.firstWorker ?? 0, model: options.model ?? MODEL },
    profile,
    tracker: new io.Tracker(profile.tracker.sheet_id),
    stopwatch: new Stopwatch(),
  };

  const { workers, firstWorker, dryRun } = run.options;
  return io.withWorker(url, workers, { first: firstWorker, waitForUrl: dryRun }, async (directory) => {
    run.stopwatch.lap("worker");
    if (directory === null) {
      return result("skipped", "in_progress", "Another worker is applying to this job.");
    }
    return applyOnWorker(run, directory);
  });
}

async function applyOnWorker(run: Run, directory: string): Promise<Result> {
  const { url, tracker, stopwatch } = run;

  const reason = await tracker.skipReason(url);
  if (reason) {
    return result("skipped", reason, "The tracker already settles this job.");
  }
  const earlierApplications = await tracker.earlierApplications(url);
  stopwatch.lap("check");

  const runId = `${runStamp()}-${basename(directory)}`;
  const runDir = join(runsDir(), runId);
  const outcome = await io.withChrome(join(directory, "chrome"), url, (chromePid) =>
    runAgentInChrome(run, directory, runDir, chromePid, earlierApplications));
  stopwatch.lap("quit");

  try {
    await record(run, outcome, runId);
  } finally {
    stopwatch.lap("record");
    const summary = { url, dry_run: run.options.dryRun, ...outcome, phases: stopwatch.laps };
    writeFileSync(join(runDir, "result.json"), JSON.stringify(summary, null, 2) + "\n");
  }
  return outcome;
}

async function runAgentInChrome(run: Run, directory: string, runDir: string, chromePid: number,
  earlierApplications: Application[]): Promise<Result> {
  const { url, profile, stopwatch, options: { dryRun, timeoutMinutes, model } } = run;
  stopwatch.lap("chrome");

  io.connectPlaywright(directory, io.devtoolsPort(join(directory, "chrome")));
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const prompt = join(runDir, "prompt.md");
  const capsolverKey = io.env("CAPSOLVER_API_KEY");
  writeFileSync(prompt, renderPrompt(url, { dryRun, profile, today: new Date(), chromePid, capsolverKey, earlierApplications }));

  let outcome: Result;
  try {
    outcome = parseResult(await io.runAgent(prompt, { cwd: directory, logDir: runDir, timeoutMinutes, model }));
  } catch (error) {
    if (!(error instanceof AgentTimeout)) {
      throw error;
    }
    outcome = result("failed", "timeout", `The agent did not finish within ${timeoutMinutes} minutes.`);
  }
  stopwatch.lap("agent");
  return outcome;
}

async function record(run: Run, outcome: Result, runId: string): Promise<void> {
  if (!run.options.dryRun) {
    await run.tracker.record(run.url, outcome, runId);
  }
  if (outcome.account) {
    await run.tracker.recordAccount(outcome.account, emailFor(run.profile, outcome.company));
  }
}
