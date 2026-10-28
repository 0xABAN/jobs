import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { finalMessage } from "../../src/agent/transcript.ts";
import { tempDir } from "../helpers.ts";

function messageEnd(role: string, text: string): object {
  return { type: "message_end", message: { role, content: [{ type: "text", text }] } };
}

test("the final message is the last assistant text, even across a U+2028", async (t) => {
  const events = [messageEnd("user", "prompt"), messageEnd("assistant", "first"), { type: "agent_end" },
    messageEnd("assistant", "line one\u2028still the same record")];
  const transcript = join(tempDir(t), "transcript.jsonl");
  writeFileSync(transcript, events.map((event) => JSON.stringify(event) + "\n").join(""));

  assert.equal(await finalMessage(transcript), "line one\u2028still the same record");
});
