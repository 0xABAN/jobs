import assert from "node:assert/strict";
import { mkdirSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { latestRun, pruneLogs } from "../../src/runs/directory.ts";
import { tempState } from "../helpers.ts";

const RUN_FILES = ["prompt.md", "transcript.jsonl", "stderr.log", "result.json"];

test("prunes all but results from runs older than three hours", (t) => {
  const runs = join(tempState(t), "runs");
  for (const run of ["20261028-090000-0", "20261028-130000-1"]) {
    mkdirSync(join(runs, run), { recursive: true });
    RUN_FILES.forEach((name) => writeFileSync(join(runs, run, name), "x"));
  }
  const fourHoursAgo = new Date(Date.now() - 4 * 3_600_000);
  RUN_FILES.forEach((name) => utimesSync(join(runs, "20261028-090000-0", name), fourHoursAgo, fourHoursAgo));

  pruneLogs();

  assert.deepEqual(readdirSync(join(runs, "20261028-090000-0")), ["result.json"]);
  assert.equal(readdirSync(join(runs, "20261028-130000-1")).length, RUN_FILES.length);
  assert.equal(latestRun(), "20261028-130000-1");
});
