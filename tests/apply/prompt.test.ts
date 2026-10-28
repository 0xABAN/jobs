import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { renderPrompt } from "../../src/apply/prompt.ts";
import { loadProfile, REPO_ROOT } from "../../src/config.ts";
import type { Application } from "../../src/tracker.ts";

const URL = "https://job-boards.greenhouse.io/example/jobs/1";

function render({ dryRun = false, earlierApplications = [] as Application[], capsolverKey = "CAP-test" as string | null } = {}) {
  return renderPrompt(URL, {
    dryRun, profile: loadProfile(join(REPO_ROOT, "profile.example.json")), today: new Date(2026, 9, 4), chromePid: 4242,
    capsolverKey, earlierApplications,
  });
}

test("fills every placeholder", () => {
  const prompt = render();

  assert.ok(!prompt.includes("${"));
  assert.ok(prompt.includes(URL));
  assert.ok(prompt.includes('"full_name": "YOUR_LEGAL_NAME"'));
  assert.ok(prompt.includes(`relative to \`${REPO_ROOT}\``));
  assert.ok(prompt.includes("pid `4242`"));
  assert.ok(prompt.includes("today's date, 10/04/2026"));
  assert.ok(!prompt.includes('"tracker"'));  // the launcher keeps the tracker
});

test("agents call CapSolver with the key", () => {
  const prompt = render();

  assert.ok(prompt.includes("**API key:** `CAP-test`"));
  assert.equal(prompt.split('"clientKey": "CAP-test"').length - 1, 2);  // createTask and getTaskResult
});

test("without a key, agents solve CAPTCHAs by hand", () => {
  const prompt = render({ capsolverKey: null });

  assert.ok(prompt.includes("**API key:** NOT CONFIGURED: skip to Manual fallback for all CAPTCHAs"));
  assert.ok(prompt.includes('"clientKey": ""'));
});

test("the run mode switches with dry runs", () => {
  assert.ok(render().includes("**Live run:**"));
  assert.ok(render({ dryRun: true }).includes("**Dry run:**"));
});

test("a dry run never enters a security code", () => {
  assert.ok(render({ dryRun: true }).includes("never enter the code"));
  assert.ok(!render().includes("never enter the code"));
});

test("lists earlier applications only when the tracker has some", () => {
  const prompt = render({ earlierApplications: [{ company: "IMC", role: "Graduate Software Engineer", applied: "2026-09-07" }] });
  assert.ok(prompt.includes("  - IMC: Graduate Software Engineer (2026-09-07)"));

  assert.ok(!render().includes("earlier applications to this employer**"));
});

test("dollar signs in prompt.md are written $$", () => {
  assert.ok(render().includes('"salary": "$45–$55/hour"'));
});
