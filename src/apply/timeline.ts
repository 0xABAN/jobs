/**
 * Where an apply run spent its time: `jobs timeline [run id]`.
 *
 * The launcher's phases come from the run's `result.json`. The agent's steps come from
 * its transcript, whose events `pi.run` stamps with `t`, the seconds since Pi launched.
 * Each agent turn is one model call, then the tools it called. The model call splits into
 * the wait for its first token, thinking, and writing the reply and tool calls; the tools
 * include the browser and other MCP calls that each codemode script made.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { events } from "../pi.ts";

type Call = {
  name: string;
  seconds: number;
  nested: boolean;  // made by a codemode script, not by the model
};

/** One agent turn. Times are seconds since Pi launched; the model's parts are durations. */
class Turn {
  start: number;
  firstToken: number | null = null;
  thinking = 0;
  modelEnd: number | null = null;  // when the model's message ended and its tools started
  outputTokens = 0;
  end: number | null = null;
  calls: Call[] = [];

  constructor(start: number) {
    this.start = start;
  }

  // Seconds of the model call and its parts (waiting, thinking, writing), once its message has ended.

  get model(): number {
    return this.modelEnd! - this.start;
  }

  get wait(): number {  // for the first token
    return (this.firstToken ?? this.modelEnd!) - this.start;
  }

  get write(): number {  // the reply and its tool calls
    return this.model - this.wait - this.thinking;
  }
}

/** Return the agent's turns and the time of the transcript's last event, in seconds since Pi launched. */
export async function readTurns(transcript: string): Promise<[Turn[], number]> {
  const turns: Turn[] = [];
  const started = new Map<string, number>();
  const modelCalls = new Set<string>();
  let thinkingSince = 0;
  let last = 0;

  for await (const event of events(transcript)) {
    if (!("t" in event)) {
      throw new Error(`${transcript} has no timestamps: it predates timestamped transcripts`);
    }
    last = event.t;
    const kind = event.type;

    if (kind === "turn_start") {
      turns.push(new Turn(last));
    } else if (kind === "message_update") {
      const turn = turns.at(-1)!;
      turn.firstToken ??= last;

      const step = event.assistantMessageEvent.type;
      if (step === "thinking_start") {
        thinkingSince = last;
      } else if (step === "thinking_end") {
        turn.thinking += last - thinkingSince;
      }
    } else if (kind === "message_end" && event.message.role === "assistant") {
      const turn = turns.at(-1)!;
      turn.modelEnd = last;
      turn.outputTokens = event.message.usage.output;
      for (const block of event.message.content) {
        if (block.type === "toolCall") {
          modelCalls.add(block.id);
        }
      }
    } else if (kind === "tool_execution_start") {
      started.set(event.toolCallId, last);
    } else if (kind === "tool_execution_end") {
      const callId: string = event.toolCallId;
      let name: string = event.toolName;
      if (name.startsWith("mcp__")) {  // mcp__<server>__<tool>: the tool name says enough
        name = name.split("__").slice(2).join("__");
      }
      turns.at(-1)!.calls.push({ name, seconds: last - started.get(callId)!, nested: !modelCalls.has(callId) });
      started.delete(callId);
    } else if (kind === "turn_end") {
      turns.at(-1)!.end = last;
    }
  }

  return [turns, last];
}

/** Describe where the run in `runDir` spent its time, turn by turn, with totals and the slowest calls. */
export async function timeline(runDir: string): Promise<string> {
  const lines = [`Run ${basename(runDir)}`];

  const resultPath = join(runDir, "result.json");
  if (existsSync(resultPath)) {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    const outcome = result.status + (result.reason ? ` (${result.reason})` : "");
    const phases = Object.entries<number>(result.phases).map(([name, seconds]) => `${name} ${seconds.toFixed(1)}s`).join(" · ");
    lines.push(`Result: ${outcome}`, `Launcher: ${phases}`);
  } else {
    lines.push("Result: still running");
  }

  const [turns, elapsed] = await readTurns(join(runDir, "transcript.jsonl"));
  lines.push("", "turn  start   model (  wait  think  write)    out   tools  calls");
  turns.forEach((turn, i) => {
    lines.push(`${String(i + 1).padStart(4)} ${turn.start.toFixed(1).padStart(6)}  ${formatModel(turn)}  ${formatTools(turn)}`);
  });

  lines.push("", ...totals(turns, elapsed), "", ...slowest(turns));
  return lines.join("\n");
}

/** Format a turn's model call as `model (wait think write) output-tokens`. */
function formatModel(turn: Turn): string {
  if (turn.modelEnd === null) {
    return "running".padStart(40);
  }

  const parts = [turn.wait, turn.thinking, turn.write].map((seconds) => seconds.toFixed(1).padStart(6)).join(" ");
  return `${turn.model.toFixed(1).padStart(6)} (${parts}) ${String(turn.outputTokens).padStart(6)}`;
}

/** Format a turn's tool time and its calls; a codemode call lists the MCP calls its script made. */
function formatTools(turn: Turn): string {
  if (turn.modelEnd === null) {
    return "";
  }

  const tools = turn.end !== null ? (turn.end - turn.modelEnd).toFixed(1).padStart(6) : "running".padStart(6);
  const nested = byName(turn.calls.filter((call) => call.nested));
  const inside = [...nested].map(([name, times]) => `${name}${times.length > 1 ? "×" + times.length : ""} ${sum(times).toFixed(1)}`)
    .join(", ");

  const calls = turn.calls.filter((call) => !call.nested).map((call) =>
    `${call.name} ${call.seconds.toFixed(1)}` + (call.name === "codemode" && inside ? `: ${inside}` : ""));
  return `${tools}  ${calls.join(" · ")}`;
}

function totals(turns: Turn[], elapsed: number): string[] {
  const finished = turns.filter((turn) => turn.modelEnd !== null);
  const model = sum(finished.map((turn) => turn.model));
  const wait = sum(finished.map((turn) => turn.wait));
  const thinking = sum(finished.map((turn) => turn.thinking));
  const tools = sum(finished.filter((turn) => turn.end !== null).map((turn) => turn.end! - turn.modelEnd!));
  const startup = turns.length ? turns[0].start : elapsed;

  const share = (seconds: number) => elapsed ? `${seconds.toFixed(1)}s (${(seconds / elapsed * 100).toFixed(0)}%)` : `${seconds.toFixed(1)}s`;

  return [
    `Agent: ${elapsed.toFixed(1)}s over ${turns.length} turns`,
    `  model   ${share(model)}: waiting ${wait.toFixed(1)}s, thinking ${thinking.toFixed(1)}s, writing ${(model - wait - thinking).toFixed(1)}s`,
    `  tools   ${share(tools)}`,
    `  startup ${share(startup)} before the first turn`,
  ];
}

/** Rank tools by total time, with how often they ran and their mean and longest run. */
function slowest(turns: Turn[], count = 10): string[] {
  const ranked = [...byName(turns.flatMap((turn) => turn.calls))].sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, count);

  const lines = ["call                        runs   total    mean     max"];
  for (const [name, times] of ranked) {
    const columns = [sum(times), sum(times) / times.length, Math.max(...times)].map((seconds) => seconds.toFixed(1).padStart(7));
    lines.push(`${name.padEnd(26)} ${String(times.length).padStart(6)} ${columns.join(" ")}`);
  }
  return lines;
}

function byName(calls: Call[]): Map<string, number[]> {
  const times = new Map<string, number[]>();
  for (const call of calls) {
    times.set(call.name, [...(times.get(call.name) ?? []), call.seconds]);
  }
  return times;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
