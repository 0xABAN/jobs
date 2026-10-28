import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";

import * as chrome from "../../src/browser/chrome.ts";
import { replace, tempDir } from "../helpers.ts";

function fakeChrome(t: TestContext, { outlivesQuit }: { outlivesQuit: boolean }): void {
  replace(t, chrome.io, "launch", async () => 123);
  replace(t, chrome.io, "close", async () => {});
  replace(t, chrome.io, "isAlive", () => outlivesQuit);
}

function createFiles(root: string, files: string[]): void {
  for (const file of files) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), "x");
  }
}

test("a run drops its caches but keeps logins", async (t) => {
  const profile = tempDir(t);
  createFiles(profile, ["Default/Cache/data", "Default/Code Cache/js", "GrShaderCache/x", "Default/Cookies", "Default/IndexedDB/site"]);
  fakeChrome(t, { outlivesQuit: false });

  await chrome.withChrome(profile, "https://job", async () => {});

  for (const dropped of ["Default/Cache", "Default/Code Cache", "GrShaderCache"]) {
    assert.ok(!existsSync(join(profile, dropped)), dropped);
  }
  for (const kept of ["Default/Cookies", "Default/IndexedDB/site"]) {
    assert.ok(existsSync(join(profile, kept)), kept);
  }
});

test("caches stay while Chrome is still running", async (t) => {
  const profile = tempDir(t);
  createFiles(profile, ["Default/Cache/data"]);
  fakeChrome(t, { outlivesQuit: true });

  await chrome.withChrome(profile, "https://job", async () => {});

  assert.ok(existsSync(join(profile, "Default/Cache")));
});
