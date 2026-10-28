import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { test } from "node:test";

import { isLocked, tryLock } from "../src/lock.ts";
import { tempDir } from "./helpers.ts";

test("a lock has one holder at a time, even within one process", (t) => {
  const path = join(tempDir(t), "locks/job.lock");

  const held = tryLock(path);
  assert.ok(held);
  assert.equal(tryLock(path), null);
  assert.ok(isLocked(path));

  held.release();
  assert.ok(!isLocked(path));
});

test("the operating system releases the lock of a process that dies", async (t) => {
  const path = join(tempDir(t), "job.lock");
  const lockModule = new URL("../src/lock.ts", import.meta.url).pathname;

  // A process that takes the lock, says so, and waits to be killed.
  const holder = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--input-type=module", "-e",
    `const { tryLock } = await import(${JSON.stringify(lockModule)}); tryLock(${JSON.stringify(path)}); `
    + "console.log('locked'); setInterval(() => {}, 1000);"], { stdio: ["ignore", "pipe", "inherit"] });
  await once(holder.stdout!, "data");
  assert.ok(isLocked(path));

  holder.kill("SIGKILL");
  await once(holder, "exit");
  assert.ok(!isLocked(path));
});
