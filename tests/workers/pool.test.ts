import assert from "node:assert/strict";
import { basename } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { running } from "../../src/workers/claims.ts";
import * as pool from "../../src/workers/pool.ts";
import { candidates, withWorker } from "../../src/workers/pool.ts";
import { replace, tempState } from "../helpers.ts";

class Waited extends Error {}

function fakeWorkers(t: TestContext, { canWait = true } = {}): void {
  tempState(t);
  replace(t, pool.io, "prepareWorker", async () => {});
  if (!canWait) {
    replace(t, pool.io, "sleep", async () => {
      throw new Waited();
    });
  }
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

  await withWorker("https://a", 1, {}, async (retry) => assert.notEqual(retry, null));

  await withWorker("https://a", 2, {}, async (low) => {
    await withWorker("https://b", 2, { first: 2 }, async (high) => {
      assert.deepEqual([basename(low!), basename(high!)], ["0", "2"]);
      await withWorker("https://a", 2, { first: 2 }, async (duplicate) => assert.equal(duplicate, null));
    });
  });
});

test("a dry run waits for another run of its URL", async (t) => {
  fakeWorkers(t, { canWait: false });

  await withWorker("https://a", 1, {}, async () => {
    await assert.rejects(withWorker("https://a", 1, { first: 1, waitForUrl: true }, async () => {}), Waited);
  });
});

test("Greenhouse runs at one employer wait for each other", async (t) => {
  fakeWorkers(t, { canWait: false });

  await withWorker("https://job-boards.greenhouse.io/tower/jobs/1", 3, {}, async () => {
    await withWorker("https://job-boards.greenhouse.io/drweng/jobs/2", 3, {}, async (other) => assert.notEqual(other, null));
    await withWorker("https://nvidia.wd5.myworkdayjobs.com/job/3", 3, {}, async (other) => assert.notEqual(other, null));

    await assert.rejects(withWorker("https://boards.greenhouse.io/tower/jobs/4", 3, {}, async () => {}), Waited);
  });
});

test("session sites run on their worker and other jobs skip it", () => {
  const sessionWorkers = new Map([[4, ["ycombinator.com"]], [5, ["jobs.apple.com"]]]);

  assert.deepEqual(candidates("https://www.ycombinator.com/companies/x/jobs/1", 20, 0, sessionWorkers), [4]);
  assert.deepEqual(candidates("https://jobs.apple.com/en-us/details/1", 20, 0, sessionWorkers), [5]);
  assert.deepEqual(candidates("https://job-boards.greenhouse.io/stripe/jobs/1", 8, 0, sessionWorkers), [0, 1, 2, 3, 6, 7]);
});
