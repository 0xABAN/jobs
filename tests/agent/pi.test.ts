import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { run } from "../../src/agent/pi.ts";
import { replace, tempDir } from "../helpers.ts";

const FAKE_PI = `#!/bin/sh
echo '{"type":"agent_start"}'
sleep 0.5
echo '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}'
`;

test("run stamps each event with its arrival time", async (t) => {
  const directory = tempDir(t);
  mkdirSync(join(directory, "bin"));
  writeFileSync(join(directory, "bin/pi"), FAKE_PI);
  chmodSync(join(directory, "bin/pi"), 0o755);
  replace(t, process.env, "PATH", `${join(directory, "bin")}:/usr/bin:/bin`);

  const final = await run(join(directory, "prompt.md"), { cwd: directory, logDir: directory, timeoutMinutes: 1 });

  assert.equal(final, "done");
  const transcript = readFileSync(join(directory, "transcript.jsonl"), "utf8").trim().split("\n");
  const [first, second] = transcript.map((line) => JSON.parse(line));
  assert.ok(first.type === "agent_start" && first.t > 0);
  assert.ok(second.t - first.t >= 0.5 && second.t - first.t < 1.0, `gap ${second.t - first.t}`);
});
