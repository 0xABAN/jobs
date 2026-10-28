import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as launcher from "../../src/apply/launcher.ts";
import { result } from "../../src/apply/result.ts";
import type { Result } from "../../src/apply/result.ts";
import type { Profile } from "../../src/config.ts";
import { replace, tempState } from "../helpers.ts";

/** Make `apply` run without Chrome, Pi, or the Sheet; return the list the fake tracker records into. */
function fakeRun(t: TestContext, agentResult: string): unknown[] {
  const state = tempState(t);
  const recorded: unknown[] = [];

  class FakeTracker {
    async skipReason() {
      return null;
    }

    async earlierApplications() {
      return [];
    }

    async record(_url: string, outcome: Result) {
      recorded.push(outcome);
    }

    async recordAccount(site: string, email: string) {
      recorded.push([site, email]);
    }
  }

  const profile = { personal: { email: "adam@example.com", email_by_employer: { NVIDIA: "adam@school.edu" } }, tracker: { sheet_id: "S" } };
  replace(t, launcher.io, "loadProfile", () => profile as unknown as Profile);
  replace(t, launcher.io, "Tracker", FakeTracker as unknown as typeof launcher.io.Tracker);
  replace(t, launcher.io, "withWorker", (async (_url: string, _count: number, _options: object, body: (directory: string) => Promise<unknown>) =>
    body(join(state, "workers/0"))) as typeof launcher.io.withWorker);
  replace(t, launcher.io, "withChrome", (async (_profile: string, _url: string, body: (pid: number) => Promise<unknown>) =>
    body(4242)) as typeof launcher.io.withChrome);
  replace(t, launcher.io, "devtoolsPort", () => 9333);
  replace(t, launcher.io, "connectPlaywright", () => {});
  replace(t, launcher.io, "env", () => null);
  replace(t, launcher.io, "runAgent", async () => "```json\n" + agentResult + "\n```");
  return recorded;
}

const OPTIONS = { dryRun: false, timeoutMinutes: 1, workers: 1 };

test("apply records and returns the agent's result", async (t) => {
  const recorded = fakeRun(t, '{"status": "applied", "reason": null, "explanation": "Submitted."}');

  const outcome = await launcher.apply("https://example.com/job", OPTIONS);

  assert.deepEqual(outcome, result("applied", null, "Submitted."));
  assert.deepEqual(recorded, [outcome]);

  const [runId] = readdirSync(launcher.runsDir());
  const phases = JSON.parse(readFileSync(join(launcher.runsDir(), runId, "result.json"), "utf8")).phases;
  assert.deepEqual(Object.keys(phases), ["worker", "check", "chrome", "agent", "quit", "record"]);
});

test("dry runs record only the account they used", async (t) => {
  const recorded = fakeRun(t, '{"status": "dry_run", "reason": null, "explanation": "Filled.", "account": "acme.wd5.myworkdayjobs.com"}');

  await launcher.apply("https://example.com/job", { ...OPTIONS, dryRun: true });

  assert.deepEqual(recorded, [["acme.wd5.myworkdayjobs.com", "adam@example.com"]]);
});

test("records an account under the employer's own email", async (t) => {
  const recorded = fakeRun(t, '{"status": "dry_run", "reason": null, "explanation": "Filled.", "company": "NVIDIA",'
    + ' "account": "nvidia.wd5.myworkdayjobs.com"}');

  await launcher.apply("https://example.com/job", { ...OPTIONS, dryRun: true });

  assert.deepEqual(recorded, [["nvidia.wd5.myworkdayjobs.com", "adam@school.edu"]]);
});

test("prunes all but results from runs older than three hours", (t) => {
  const runs = join(tempState(t), "runs");
  for (const run of ["old", "recent"]) {
    mkdirSync(join(runs, run), { recursive: true });
    for (const name of ["prompt.md", "transcript.jsonl", "stderr.log", "result.json"]) {
      writeFileSync(join(runs, run, name), "x");
    }
  }

  const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000);
  for (const name of readdirSync(join(runs, "old"))) {
    utimesSync(join(runs, "old", name), fourHoursAgo, fourHoursAgo);
  }

  launcher.pruneLogs();

  assert.deepEqual(readdirSync(join(runs, "old")), ["result.json"]);
  assert.equal(readdirSync(join(runs, "recent")).length, 4);
});

test("skips banned sites without claiming a worker", async (t) => {
  replace(t, launcher.io, "withWorker", () => {
    throw new Error("claimed a worker");
  });

  const outcome = await launcher.apply("https://jobs.lever.co/acme/123", OPTIONS);

  assert.deepEqual([outcome.status, outcome.reason], ["skipped", "banned_site"]);
});

test("connects Playwright to this run's Chrome in place of CUA", (t) => {
  const state = tempState(t);
  const repo = join(state, "repo");
  const worker = join(state, "worker");
  mkdirSync(join(repo, ".pi"), { recursive: true });
  writeFileSync(join(repo, ".pi/mcp.json"), JSON.stringify({ mcpServers: {
    gmail: { command: "gmail" }, "google-sheets": { command: "sheets" }, "cua-driver": { command: "cua" } } }));
  mkdirSync(join(worker, ".pi"), { recursive: true });
  symlinkSync(join(repo, ".pi/mcp.json"), join(worker, ".pi/mcp.json"));  // as older workers have it

  launcher.connectPlaywright(worker, 9333, join(repo, ".pi/mcp.json"));

  const servers = JSON.parse(readFileSync(join(worker, ".pi/mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(servers), ["gmail", "playwright"]);
  assert.ok(servers.playwright.args.includes("http://127.0.0.1:9333"));
  assert.ok("cua-driver" in JSON.parse(readFileSync(join(repo, ".pi/mcp.json"), "utf8")).mcpServers);  // the repo's config is untouched
});
