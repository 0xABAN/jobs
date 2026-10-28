import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { readTurns, timeline } from "../../src/apply/timeline.ts";
import { tempDir } from "../helpers.ts";

function event(t: number, type: string, fields: object = {}): string {
  return JSON.stringify({ t, type, ...fields });
}

function update(t: number, step: string): string {
  return event(t, "message_update", { assistantMessageEvent: { type: step } });
}

function assistant(t: number, callIds: string[], output = 100): string {
  const content = callIds.map((id) => ({ type: "toolCall", id, name: "codemode" }));
  return event(t, "message_end", { message: { role: "assistant", content, usage: { output } } });
}

function tool(t: number, kind: string, callId: string, name: string): string {
  return event(t, `tool_execution_${kind}`, { toolCallId: callId, toolName: name });
}

// One finished turn: 1 s waiting, 2 s thinking, 1 s writing a codemode call whose script
// spends 3 s of its 5 s in two browser calls; then a second turn still writing its reply.
const TRANSCRIPT = [
  event(0.5, "session"),
  event(2.0, "turn_start"),
  update(3.0, "thinking_start"), update(5.0, "thinking_end"), update(5.5, "toolcall_start"),
  assistant(6.0, ["model-call"]),
  tool(6.0, "start", "model-call", "codemode"),
  tool(6.5, "start", "browser-1", "mcp__playwright__browser_snapshot"), tool(8.5, "end", "browser-1", "mcp__playwright__browser_snapshot"),
  tool(9.0, "start", "browser-2", "mcp__playwright__browser_click"), tool(10.0, "end", "browser-2", "mcp__playwright__browser_click"),
  tool(11.0, "end", "model-call", "codemode"),
  event(11.0, "turn_end"),
  event(11.0, "turn_start"),
  update(14.0, "text_start"),
];

test("splits each turn into model and tool time", async (t) => {
  const transcript = join(tempDir(t), "transcript.jsonl");
  writeFileSync(transcript, TRANSCRIPT.join("\n") + "\n");

  const [turns, elapsed] = await readTurns(transcript);

  const [first, second] = turns;
  assert.deepEqual([first.start, first.firstToken, first.thinking, first.modelEnd, first.end], [2.0, 3.0, 2.0, 6.0, 11.0]);
  assert.deepEqual(first.calls.map((call) => [call.name, call.seconds, call.nested]), [
    ["browser_snapshot", 2.0, true], ["browser_click", 1.0, true], ["codemode", 5.0, false],
  ]);
  assert.deepEqual([second.firstToken, second.modelEnd], [14.0, null]);
  assert.equal(elapsed, 14.0);
});

test("the timeline of a running run", async (t) => {
  const runDir = tempDir(t);
  writeFileSync(join(runDir, "transcript.jsonl"), TRANSCRIPT.join("\n") + "\n");

  const report = await timeline(runDir);

  assert.ok(report.includes("Result: still running"));
  assert.ok(report.includes("   1    2.0     4.0 (   1.0    2.0    1.0)    100     5.0  codemode 5.0: browser_snapshot 2.0, browser_click 1.0"));
  assert.ok(report.includes("  model   4.0s (29%): waiting 1.0s, thinking 2.0s, writing 1.0s"));
  assert.ok(report.includes("codemode                        1     5.0     5.0     5.0"));
});
