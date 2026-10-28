import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as workers from "../../src/apply/workers.ts";
import { candidates, greenhouseBoard, running, sharesCodes, withWorker } from "../../src/apply/workers.ts";
import { paths } from "../../src/config.ts";
import { replace, tempDir, tempState } from "../helpers.ts";

/** Keep workers in a temporary directory and claim them without copying a Chrome profile. */
function fakeWorkers(t: TestContext): void {
  tempState(t);
  replace(t, workers.io, "prepare", async () => {});
}

/** Thrown where a claim would sleep before trying the workers again. */
class Waited extends Error {}

function noWaiting(t: TestContext): void {
  replace(t, workers.io, "sleep", async () => {
    throw new Waited();
  });
}

test("each URL runs on one worker at a time", async (t) => {
  fakeWorkers(t);

  await withWorker("https://a", 2, {}, async (first) => {
    await withWorker("https://a", 2, {}, async (duplicate) => assert.equal(duplicate, null));

    await withWorker("https://b", 2, {}, async (second) => {
      assert.deepEqual(new Set([basename(first!), basename(second!)]), new Set(["0", "1"]));
      assert.deepEqual(running(), ["https://a", "https://b"]);
    });
  });
  assert.deepEqual(running(), []);

  // A finished worker's job file still names its last URL; it must not block a retry.
  await withWorker("https://a", 1, {}, async (retry) => assert.notEqual(retry, null));

  // Experiments in parallel keep separate workers, but never apply to one URL twice at once.
  await withWorker("https://a", 2, {}, async (low) => {
    await withWorker("https://b", 2, { first: 2 }, async (high) => {
      assert.deepEqual([basename(low!), basename(high!)], ["0", "2"]);
      await withWorker("https://a", 2, { first: 2 }, async (duplicate) => assert.equal(duplicate, null));
    });
  });
});

test("a run can wait for another run of its URL", async (t) => {
  fakeWorkers(t);
  noWaiting(t);

  await withWorker("https://a", 1, {}, async () => {
    // Worker 1 is free, but worker 0 has the URL, so the claim waits instead of running with null.
    await assert.rejects(withWorker("https://a", 1, { first: 1, waitForUrl: true }, async () => {}), Waited);
  });
});

test("Greenhouse runs at one employer wait for each other", async (t) => {
  fakeWorkers(t);
  noWaiting(t);

  await withWorker("https://job-boards.greenhouse.io/tower/jobs/1", 3, {}, async () => {
    // Another employer's Greenhouse job, and another site's job, run alongside.
    await withWorker("https://job-boards.greenhouse.io/drweng/jobs/2", 3, {}, async (other) => assert.notEqual(other, null));
    await withWorker("https://nvidia.wd5.myworkdayjobs.com/job/3", 3, {}, async (other) => assert.notEqual(other, null));

    // The same employer waits, even with a free worker, so the two never share a code email.
    await assert.rejects(withWorker("https://boards.greenhouse.io/tower/jobs/4", 3, {}, async () => {}), Waited);
  });
});

for (const [url, board] of [
  ["https://job-boards.greenhouse.io/stripe/jobs/8128745", "stripe"],
  ["https://job-boards.eu.greenhouse.io/imc/jobs/4907430101?gh_src=x", "imc"],
  ["https://job-boards.greenhouse.io/embed/job_app?for=waymo&token=7", "waymo"],
  ["https://app.greenhouse.io/embed/job_app?token=8044334", ""],
  ["https://jobs.ashbyhq.com/openai/55150071", null],
] as const) {
  test(`the Greenhouse board comes from the URL: ${url}`, () => {
    assert.equal(greenhouseBoard(url), board);
  });
}

test("a Greenhouse URL that hides its board waits for any Greenhouse run", () => {
  const hidden = "https://app.greenhouse.io/embed/job_app?token=8024128";

  assert.ok(sharesCodes(hidden, "https://job-boards.greenhouse.io/stripe/jobs/1"));
  assert.ok(!sharesCodes(hidden, "https://jobs.ashbyhq.com/openai/1"));
  assert.ok(!sharesCodes("https://job-boards.greenhouse.io/stripe/jobs/1", ""));
});

test("prepared Chrome copies keep session cookies and never offer to save passwords", async (t) => {
  const directory = tempDir(t);
  const profile = join(directory, "profile");
  mkdirSync(join(profile, "Default"), { recursive: true });
  writeFileSync(join(profile, "Default/Preferences"), JSON.stringify({ profile: { name: "jobs" } }));
  writeFileSync(join(profile, "SingletonLock"), "");
  mkdirSync(join(profile, "Default/Cache"));
  replace(t, paths, "chromeProfile", profile);

  await workers.prepare(join(directory, "worker"));

  const preferences = JSON.parse(readFileSync(join(directory, "worker/chrome/Default/Preferences"), "utf8"));
  assert.deepEqual(preferences, {
    profile: { name: "jobs", password_manager_enabled: false },
    credentials_enable_service: false,
    session: { restore_on_startup: 1 },
  });
  // Files that tie a profile to a running Chrome, and caches, stay behind.
  assert.throws(() => readFileSync(join(directory, "worker/chrome/SingletonLock")), { code: "ENOENT" });
  assert.throws(() => readFileSync(join(directory, "worker/chrome/Default/Cache")), { code: "ENOENT" });
});

test("session sites run on their worker and other jobs skip it", () => {
  const sessionWorkers = new Map([[4, ["ycombinator.com"]], [5, ["jobs.apple.com"]]]);

  assert.deepEqual(candidates("https://www.ycombinator.com/companies/x/jobs/1", 20, 0, sessionWorkers), [4]);
  assert.deepEqual(candidates("https://jobs.apple.com/en-us/details/1", 20, 0, sessionWorkers), [5]);
  assert.deepEqual(candidates("https://job-boards.greenhouse.io/stripe/jobs/1", 8, 0, sessionWorkers), [0, 1, 2, 3, 6, 7]);
});
