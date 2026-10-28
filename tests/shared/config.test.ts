import assert from "node:assert/strict";
import { test } from "node:test";

import { emailFor } from "../../src/shared/config.ts";
import type { Profile } from "../../src/shared/config.ts";

const PROFILE = { personal: { email: "adam@gmail.com", email_by_employer: { NVIDIA: "adam@psu.edu" } } } as unknown as Profile;

for (const [company, expected] of [
  ["NVIDIA", "adam@psu.edu"],
  ["Nvidia Corporation", "adam@psu.edu"],
  ["Adobe", "adam@gmail.com"],
  [null, "adam@gmail.com"],
] as const) {
  test(`applies to ${company} with ${expected}`, () => {
    assert.equal(emailFor(PROFILE, company), expected);
  });
}

test("a profile without employer emails uses the main one", () => {
  assert.equal(emailFor({ personal: { email: "adam@gmail.com" } } as Profile, "NVIDIA"), "adam@gmail.com");
});
