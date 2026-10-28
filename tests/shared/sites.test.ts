import assert from "node:assert/strict";
import { test } from "node:test";

import { atsBoard, banned } from "../../src/shared/sites.ts";

for (const [url, expected] of [
  ["https://jobs.lever.co/acme/123", true],
  ["https://lever.co/", true],
  ["https://job-boards.greenhouse.io/acme/jobs/1", false],
  ["https://notlever.co/jobs/1", false],
] as const) {
  test(`bans Lever and its subdomains: ${url}`, () => {
    assert.equal(banned(url), expected);
  });
}

for (const [url, board] of [
  ["https://job-boards.greenhouse.io/stripe/jobs/8128745", ["greenhouse.io", "stripe"]],
  ["https://job-boards.greenhouse.io/embed/job_app?for=Waymo&token=7", ["greenhouse.io", "waymo"]],
  ["https://app.greenhouse.io/embed/job_app?token=8044334", ["greenhouse.io", ""]],
  ["https://jobs.ashbyhq.com/openai/55150071", ["ashbyhq.com", "openai"]],
  ["https://nvidia.wd5.myworkdayjobs.com/job/1", null],
  ["", null],
] as const) {
  test(`names the employer's board on shared application sites: ${url || "(empty)"}`, () => {
    assert.deepEqual(atsBoard(url), board);
  });
}
