import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { finalMessage, run } from "../src/pi.ts";
import { replace, tempDir } from "./helpers.ts";

test("the final message is the last assistant text", async (t) => {
  const messageEnd = (role: string, text: string) => ({ type: "message_end", message: { role, content: [{ type: "text", text }] } });

  // U+2028 separates lines for some line splitters but is not a record boundary in Pi's JSONL.
  const events = [messageEnd("user", "prompt"), messageEnd("assistant", "first"), { type: "agent_end" },
    messageEnd("assistant", "line one\u2028still the same record")];
  const transcript = join(tempDir(t), "transcript.jsonl");
  writeFileSync(transcript, events.map((event) => JSON.stringify(event) + "\n").join(""));

  assert.equal(await finalMessage(transcript), "line one\u2028still the same record");
});

test("run stamps each event with its arrival time", async (t) => {
  const directory = tempDir(t);

  // A stand-in for Pi that emits two events half a second apart.
  const fakePi = join(directory, "bin/pi");
  mkdirSync(join(directory, "bin"));
  writeFileSync(fakePi, "#!/bin/sh\n"
    + "echo '{\"type\":\"agent_start\"}'\n"
    + "sleep 0.5\n"
    + "echo '{\"type\":\"message_end\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"done\"}]}}'\n");
  chmodSync(fakePi, 0o755);
  replace(t, process.env, "PATH", `${join(directory, "bin")}:/usr/bin:/bin`);

  assert.equal(await run(join(directory, "prompt.md"), { cwd: directory, logDir: directory, timeoutMinutes: 1 }), "done");

  const [first, second] = readFileSync(join(directory, "transcript.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  // The first exec of a new script can take most of a second on macOS, so only the gap is exact.
  assert.ok(first.type === "agent_start" && first.t > 0);
  assert.ok(second.t - first.t >= 0.5 && second.t - first.t < 1.0, `gap ${second.t - first.t}`);
});
