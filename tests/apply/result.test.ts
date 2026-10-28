import assert from "node:assert/strict";
import { test } from "node:test";

import { parseResult, result } from "../../src/apply/result.ts";

function block(reported: object): string {
  return "Done.\n\n```json\n" + JSON.stringify(reported) + "\n```";
}

for (const reported of [
  { status: "applied", reason: null, explanation: "Submitted.", company: "Acme", role: "Intern", salary: "$40/hour" },
  { status: "dry_run", reason: null, explanation: "Filled." },
  { status: "failed", reason: "missing_fact", explanation: "No ZIP code." },
  { status: "failed", reason: "stuck", explanation: "x", account: "acme.wd5.myworkdayjobs.com" },
] as const) {
  test(`parses a valid result: ${reported.status} ${reported.reason}`, () => {
    const { status, reason, explanation, ...details } = reported;
    assert.deepEqual(parseResult(block(reported)), result(status, reason, explanation, details));
  });
}

test("uses the last json block", () => {
  const message = block({ status: "failed", reason: "stuck", explanation: "x" }) + "\n"
    + block({ status: "applied", reason: null, explanation: "y" });

  assert.equal(parseResult(message).status, "applied");
});

for (const [message, why] of [
  ["I applied.", "no block"],
  ["```json\n{not json}\n```", "no JSON"],
  ["```json\n[1, 2]\n```", "no object"],
  [block({ status: "applied", reason: null }), "a missing field"],
  [block({ status: "applied", reason: null, explanation: "x", extra: 1 }), "an unknown field"],
  [block({ status: "done", reason: null, explanation: "x" }), "an unknown status"],
  [block({ status: "failed", reason: null, explanation: "x" }), "a failure without a reason"],
  [block({ status: "applied", reason: "stuck", explanation: "x" }), "a success with a reason"],
  [block({ status: "skipped", reason: "in_progress", explanation: "x" }), "a launcher-only status"],
]) {
  test(`rejects a result with ${why}`, () => {
    assert.equal(parseResult(message).reason, "no_result");
  });
}
