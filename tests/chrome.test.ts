import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as chrome from "../src/chrome.ts";
import { replace, tempDir } from "./helpers.ts";

/** Run Chrome on `profile` without launching it; `alive` says whether it outlives the quit. */
function fakeChrome(t: TestContext, alive: boolean): void {
  replace(t, chrome.io, "launch", async () => 123);
  replace(t, chrome.io, "close", async () => {});
  replace(t, chrome.io, "alive", () => alive);
}

test("a run drops its caches but keeps logins", async (t) => {
  const profile = tempDir(t);
  for (const keptOrDropped of ["Default/Cache/data", "Default/Code Cache/js", "GrShaderCache/x", "Default/Cookies", "Default/IndexedDB/site"]) {
    mkdirSync(dirname(join(profile, keptOrDropped)), { recursive: true });
    writeFileSync(join(profile, keptOrDropped), "x");
  }
  fakeChrome(t, false);

  await chrome.withChrome(profile, "https://job", async () => {});

  assert.ok(!existsSync(join(profile, "Default/Cache")));
  assert.ok(!existsSync(join(profile, "Default/Code Cache")));
  assert.ok(!existsSync(join(profile, "GrShaderCache")));
  assert.ok(existsSync(join(profile, "Default/Cookies")));
  assert.ok(existsSync(join(profile, "Default/IndexedDB/site")));
});

test("caches stay while Chrome is still running", async (t) => {
  const profile = tempDir(t);
  mkdirSync(join(profile, "Default/Cache"), { recursive: true });
  fakeChrome(t, true);

  await chrome.withChrome(profile, "https://job", async () => {});

  assert.ok(existsSync(join(profile, "Default/Cache")));
});
