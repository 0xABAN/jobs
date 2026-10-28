import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { events } from "../agent/transcript.ts";

const SLOWEST_SHOWN = 10;

type Call = { name: string; seconds: number; nested: boolean };

export class Turn {
  start: number;
  firstToken: number | null = null;
  thinking = 0;
  modelEnd: number | null = null;
  outputTokens = 0;
  end: number | null = null;
  calls: Call[] = [];

  constructor(start: number) {
    this.start = start;
  }

  get model(): number {
    return this.modelEnd! - this.start;
  }

  get wait(): number {
    return (this.firstToken ?? this.modelEnd!) - this.start;
  }

  get write(): number {
    return this.model - this.wait - this.thinking;
  }

  get tools(): number | null {
    return this.end === null || this.modelEnd === null ? null : this.end - this.modelEnd;
  }
}

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
    const turn = turns.at(-1)!;

    switch (event.type) {
      case "turn_start":
        turns.push(new Turn(last));
        break;
      case "message_update":
        turn.firstToken ??= last;
        if (event.assistantMessageEvent.type === "thinking_start") {
          thinkingSince = last;
        } else if (event.assistantMessageEvent.type === "thinking_end") {
          turn.thinking += last - thinkingSince;
        }
        break;
      case "message_end":
        if (event.message.role === "assistant") {
          turn.modelEnd = last;
          turn.outputTokens = event.message.usage.output;
          event.message.content.filter((block: any) => block.type === "toolCall").forEach((block: any) => modelCalls.add(block.id));
        }
        break;
      case "tool_execution_start":
        started.set(event.toolCallId, last);
        break;
      case "tool_execution_end":
        turn.calls.push({
          name: toolName(event.toolName),
          seconds: last - started.get(event.toolCallId)!,
          nested: !modelCalls.has(event.toolCallId),
        });
        started.delete(event.toolCallId);
        break;
      case "turn_end":
        turn.end = last;
        break;
    }
  }

  return [turns, last];
}

export async function timeline(runDir: string): Promise<string> {
  const [turns, elapsed] = await readTurns(join(runDir, "transcript.jsonl"));

  return [
    `Run ${basename(runDir)}`,
    ...launcherSummary(join(runDir, "result.json")),
    "",
    "turn  start   model (  wait  think  write)    out   tools  calls",
    ...turns.map((turn, i) => `${String(i + 1).padStart(4)} ${seconds(turn.start, 6)}  ${modelColumns(turn)}  ${toolColumns(turn)}`),
    "",
    ...totals(turns, elapsed),
    "",
    ...slowest(turns),
  ].join("\n");
}

function toolName(name: string): string {
  return name.startsWith("mcp__") ? name.split("__").slice(2).join("__") : name;
}

function launcherSummary(resultPath: string): string[] {
  if (!existsSync(resultPath)) {
    return ["Result: still running"];
  }

  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  const outcome = result.status + (result.reason ? ` (${result.reason})` : "");
  const phases = Object.entries<number>(result.phases).map(([name, time]) => `${name} ${time.toFixed(1)}s`).join(" · ");
  return [`Result: ${outcome}`, `Launcher: ${phases}`];
}

function modelColumns(turn: Turn): string {
  if (turn.modelEnd === null) {
    return "running".padStart(40);
  }

  const parts = [turn.wait, turn.thinking, turn.write].map((part) => seconds(part, 6)).join(" ");
  return `${seconds(turn.model, 6)} (${parts}) ${String(turn.outputTokens).padStart(6)}`;
}

function toolColumns(turn: Turn): string {
  if (turn.modelEnd === null) {
    return "";
  }

  const tools = turn.tools === null ? "running".padStart(6) : seconds(turn.tools, 6);
  const nested = [...byName(turn.calls.filter((call) => call.nested))]
    .map(([name, times]) => `${name}${times.length > 1 ? "×" + times.length : ""} ${sum(times).toFixed(1)}`)
    .join(", ");
  const calls = turn.calls
    .filter((call) => !call.nested)
    .map((call) => `${call.name} ${call.seconds.toFixed(1)}` + (call.name === "codemode" && nested ? `: ${nested}` : ""));
  return `${tools}  ${calls.join(" · ")}`;
}

function totals(turns: Turn[], elapsed: number): string[] {
  const finished = turns.filter((turn) => turn.modelEnd !== null);
  const model = sum(finished.map((turn) => turn.model));
  const wait = sum(finished.map((turn) => turn.wait));
  const thinking = sum(finished.map((turn) => turn.thinking));
  const tools = sum(finished.map((turn) => turn.tools ?? 0));
  const startup = turns.length ? turns[0].start : elapsed;
  const share = (time: number) => (elapsed ? `${time.toFixed(1)}s (${((time / elapsed) * 100).toFixed(0)}%)` : `${time.toFixed(1)}s`);

  return [
    `Agent: ${elapsed.toFixed(1)}s over ${turns.length} turns`,
    `  model   ${share(model)}: waiting ${wait.toFixed(1)}s, thinking ${thinking.toFixed(1)}s, writing ${(model - wait - thinking).toFixed(1)}s`,
    `  tools   ${share(tools)}`,
    `  startup ${share(startup)} before the first turn`,
  ];
}

function slowest(turns: Turn[]): string[] {
  const ranked = [...byName(turns.flatMap((turn) => turn.calls))]
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .slice(0, SLOWEST_SHOWN);

  return [
    "call                        runs   total    mean     max",
    ...ranked.map(([name, times]) => {
      const columns = [sum(times), sum(times) / times.length, Math.max(...times)].map((time) => seconds(time, 7));
      return `${name.padEnd(26)} ${String(times.length).padStart(6)} ${columns.join(" ")}`;
    }),
  ];
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

function seconds(value: number, width: number): string {
  return value.toFixed(1).padStart(width);
}
