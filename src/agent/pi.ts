import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { join } from "node:path";

import { killProcessGroup } from "../shared/process.ts";
import { EXCLUDED_TOOLS, EXTENSIONS, MODEL, SKILLS } from "./settings.ts";
import { finalMessage, writeTimestamped } from "./transcript.ts";

export class AgentTimeout extends Error {}

export type RunOptions = { cwd: string; logDir: string; timeoutMinutes: number; model?: string };

const runningGroups = new Set<number>();

export async function run(prompt: string, { cwd, logDir, timeoutMinutes, model = MODEL }: RunOptions): Promise<string> {
  const transcriptPath = join(logDir, "transcript.jsonl");
  const transcript = openSync(transcriptPath, "w");
  const stderr = openSync(join(logDir, "stderr.log"), "w");

  const agent = spawn("pi", piArguments(prompt, model), { cwd, stdio: ["ignore", "pipe", stderr], detached: true });
  const launched = performance.now();
  const exited = new Promise<void>((resolve, reject) => {
    agent.once("error", reject);
    agent.once("close", () => resolve());
  });

  const group = agent.pid;
  if (group !== undefined) {
    runningGroups.add(group);
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(group!);
  }, timeoutMinutes * 60_000);

  try {
    await Promise.all([writeTimestamped(agent.stdout!, transcript, launched), exited]);
  } finally {
    clearTimeout(timer);
    runningGroups.delete(group!);
    closeSync(transcript);
    closeSync(stderr);
  }

  if (timedOut) {
    throw new AgentTimeout(`The agent did not finish within ${timeoutMinutes} minutes.`);
  }
  return finalMessage(transcriptPath);
}

export function stopAgents(): void {
  runningGroups.forEach(killProcessGroup);
}

function piArguments(prompt: string, model: string): string[] {
  return [
    "--mode", "json",
    "--no-session",
    "--no-context-files",
    "--no-extensions", ...EXTENSIONS.flatMap((extension) => ["-e", extension]),
    "--no-skills", ...SKILLS.flatMap((skill) => ["--skill", skill]),
    "--approve",
    "--exclude-tools", EXCLUDED_TOOLS,
    "--model", model,
    `@${prompt}`,
  ];
}
