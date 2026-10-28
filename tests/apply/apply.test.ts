import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as applyModule from "../../src/apply/apply.ts";
import { apply } from "../../src/apply/apply.ts";
import { result } from "../../src/apply/result.ts";
import type { Result } from "../../src/apply/result.ts";
import { runsDir } from "../../src/runs/directory.ts";
import type { Profile } from "../../src/shared/config.ts";
import { replace, tempState } from "../helpers.ts";

const { io } = applyModule;
const PROFILE = { personal: { email: "adam@example.com", email_by_employer: { NVIDIA: "adam@school.edu" } }, tracker: { sheet_id: "S" } };
const OPTIONS = { dryRun: false, timeoutMinutes: 1, workers: 1 };

function fakeRun(t: TestContext, agentResult: object): unknown[] {
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

  replace(t, io, "loadProfile", () => PROFILE as unknown as Profile);
  replace(t, io, "Tracker", FakeTracker as unknown as typeof io.Tracker);
  replace(t, io, "withWorker", ((_url, _count, _options, body) => body(join(state, "workers/0"))) as typeof io.withWorker);
  replace(t, io, "withChrome", ((_profile, _url, body) => body(4242)) as typeof io.withChrome);
  replace(t, io, "devtoolsPort", () => 9333);
  replace(t, io, "connectPlaywright", () => {});
  replace(t, io, "env", () => null);
  replace(t, io, "runAgent", async () => "```json\n" + JSON.stringify(agentResult) + "\n```");
  return recorded;
}

test("apply records and returns the agent's result", async (t) => {
  const recorded = fakeRun(t, { status: "applied", reason: null, explanation: "Submitted." });

  const outcome = await apply("https://example.com/job", OPTIONS);

  assert.deepEqual(outcome, result("applied", null, "Submitted."));
  assert.deepEqual(recorded, [outcome]);
  const [runId] = readdirSync(runsDir());
  const { phases } = JSON.parse(readFileSync(join(runsDir(), runId, "result.json"), "utf8"));
  assert.deepEqual(Object.keys(phases), ["worker", "check", "chrome", "agent", "quit", "record"]);
});

test("dry runs record only the account they used", async (t) => {
  const recorded = fakeRun(t, { status: "dry_run", reason: null, explanation: "Filled.", account: "acme.wd5.myworkdayjobs.com" });

  await apply("https://example.com/job", { ...OPTIONS, dryRun: true });

  assert.deepEqual(recorded, [["acme.wd5.myworkdayjobs.com", "adam@example.com"]]);
});

test("records an account under the employer's own email", async (t) => {
  const recorded = fakeRun(t, {
    status: "dry_run", reason: null, explanation: "Filled.", company: "NVIDIA", account: "nvidia.wd5.myworkdayjobs.com",
  });

  await apply("https://example.com/job", { ...OPTIONS, dryRun: true });

  assert.deepEqual(recorded, [["nvidia.wd5.myworkdayjobs.com", "adam@school.edu"]]);
});

test("skips banned sites without claiming a worker", async (t) => {
  replace(t, io, "withWorker", () => {
    throw new Error("claimed a worker");
  });

  const outcome = await apply("https://jobs.lever.co/acme/123", OPTIONS);

  assert.deepEqual([outcome.status, outcome.reason], ["skipped", "banned_site"]);
});
