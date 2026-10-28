import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { paths } from "../../src/shared/config.ts";
import { prepareWorker } from "../../src/workers/profile.ts";
import { replace, tempDir } from "../helpers.ts";

test("a worker's Chrome copy keeps sessions, offers no password saving, and leaves caches behind", async (t) => {
  const directory = tempDir(t);
  const profile = join(directory, "profile");
  mkdirSync(join(profile, "Default/Cache"), { recursive: true });
  writeFileSync(join(profile, "Default/Preferences"), JSON.stringify({ profile: { name: "jobs" } }));
  writeFileSync(join(profile, "SingletonLock"), "");
  replace(t, paths, "chromeProfile", profile);

  await prepareWorker(join(directory, "worker"));

  const copy = join(directory, "worker/chrome");
  assert.deepEqual(JSON.parse(readFileSync(join(copy, "Default/Preferences"), "utf8")), {
    profile: { name: "jobs", password_manager_enabled: false },
    credentials_enable_service: false,
    session: { restore_on_startup: 1 },
  });
  assert.ok(!existsSync(join(copy, "SingletonLock")));
  assert.ok(!existsSync(join(copy, "Default/Cache")));
});
