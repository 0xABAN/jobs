import assert from "node:assert/strict";
import { test } from "node:test";

import { greenhouseBoard, sharesCodes } from "../../src/workers/claims.ts";

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
