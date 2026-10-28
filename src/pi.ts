/** Run a headless Pi agent on a prompt file and read its final message. */

import { spawn } from "node:child_process";
import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// The only extensions an apply agent needs: MCP servers and codemode. Its OpenAI Codex provider is built in.
// Adam's other global extensions would add seconds to every start, and tools a headless agent must not have.
export const EXTENSIONS = ["builtin:mcp", "builtin:codemode"];

// The only skill the apply prompt uses, for required essays.
export const SKILLS = [join(homedir(), ".pi/agent/skills/write")];

// Playwright tools that run Playwright code, close the job's tab, or change the browser are not the agent's to use.
// It keeps browser_evaluate, which runs the prompt's CAPTCHA scripts in the page.
// Agents only read Gmail, and their token is read-only; its tools that send, delete, or change mail are excluded too.
export const EXCLUDED_TOOLS = [
  ...["run_code_unsafe", "close", "resize", "emulate_media", "network_requests", "network_request", "console_messages"]
    .map((name) => `mcp__playwright__browser_${name}`),
  ...["send_email", "draft_email", "update_draft", "send_draft", "delete_draft", "reply_all", "delete_email",
    "batch_delete_emails", "modify_email", "batch_modify_emails", "modify_thread", "report_phishing",
    "batch_report_phishing", "create_label", "update_label", "delete_label", "get_or_create_label", "create_filter",
    "create_filter_from_template", "delete_filter", "download_attachment", "download_email"]
    .map((name) => `mcp__gmail__${name}`),
].join(",");

// Apply agents' model and thinking level, fixed so Adam's interactive Pi defaults don't change them.
export const MODEL = "openai-codex/gpt-6.1-sol:low";

/** Thrown when an agent runs past its time and has been stopped. */
export class AgentTimeout extends Error {}

// The process groups of running agents, so an interrupted command can stop them (`stopAgents`).
const running = new Set<number>();

type RunOptions = { cwd: string; logDir: string; timeoutMinutes: number; model?: string };

/**
 * Run Pi on `prompt` from `cwd`, log its transcript in `logDir`, and return its final message.
 *
 * Pi loads `cwd`'s `.pi/mcp.json` but no context files, so the prompt is its only
 * instructions. Each transcript event gets a `t` field, the seconds since Pi launched
 * when the event arrived, because Pi's own events mostly lack timestamps. Throws
 * `AgentTimeout` after killing Pi and its MCP servers when it runs past `timeoutMinutes`.
 */
export async function run(prompt: string, { cwd, logDir, timeoutMinutes, model = MODEL }: RunOptions): Promise<string> {
  const command = [
    "--mode", "json", "--no-session",
    "--no-context-files",
    "--no-extensions", ...EXTENSIONS.flatMap((extension) => ["-e", extension]),
    "--no-skills", ...SKILLS.flatMap((skill) => ["--skill", skill]),
    "--approve",  // load the .pi/mcp.json without a trust prompt
    "--exclude-tools", EXCLUDED_TOOLS,
    "--model", model,
    `@${prompt}`,
  ];
  const transcriptPath = join(logDir, "transcript.jsonl");
  const stderr = openSync(join(logDir, "stderr.log"), "w");
  const transcript = openSync(transcriptPath, "w");

  // A process group of its own, so a timeout can kill Pi together with its MCP servers.
  const agent = spawn("pi", command, { cwd, stdio: ["ignore", "pipe", stderr], detached: true });
  const launched = performance.now();
  const exited = new Promise<void>((resolve, reject) => {
    agent.once("error", reject);  // Pi did not start
    agent.once("close", () => resolve());
  });

  const group = agent.pid;
  if (group !== undefined) {
    running.add(group);
  }

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killGroup(group!);
  }, timeoutMinutes * 60_000);

  try {
    await Promise.all([copyTimestamped(agent.stdout!, transcript, launched), exited]);
  } finally {
    clearTimeout(timer);
    running.delete(group!);
    closeSync(transcript);
    closeSync(stderr);
  }

  if (timedOut) {
    throw new AgentTimeout(`The agent did not finish within ${timeoutMinutes} minutes.`);
  }
  return finalMessage(transcriptPath);
}

/** Kill every running agent and its MCP servers, as when `jobs apply` is interrupted. */
export function stopAgents(): void {
  for (const group of running) {
    killGroup(group);
  }
}

function killGroup(group: number): void {
  try {
    process.kill(-group, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {  // it already exited
      throw error;
    }
  }
}

/**
 * Copy Pi's JSON events to `transcript` as they arrive, each with `t` inserted as its first field.
 *
 * Lines are split on raw newline bytes, as Pi frames them, and written at once, so a running
 * agent's transcript is current.
 */
async function copyTimestamped(stdout: NodeJS.ReadableStream, transcript: number, launched: number): Promise<void> {
  let pending = Buffer.alloc(0);

  for await (const chunk of stdout) {
    pending = Buffer.concat([pending, chunk as Buffer]);

    let end: number;
    while ((end = pending.indexOf(0x0a)) !== -1) {
      const line = pending.subarray(0, end + 1);
      pending = pending.subarray(end + 1);

      if (line.toString("utf8").trim()) {
        const seconds = ((performance.now() - launched) / 1000).toFixed(3);
        const fields = line[0] === 0x7b ? line.subarray(1) : line;  // after the event's opening brace
        writeSync(transcript, Buffer.concat([Buffer.from(`{"t":${seconds},`), fields]));
      }
    }
  }
}

/**
 * Yield the events of a Pi JSON-mode transcript one at a time; transcripts reach about 100 MB.
 *
 * Lines end at LF only, as Pi frames records: a JSON string may hold U+2028, which some
 * line splitters also treat as a line break.
 */
export async function* events(transcript: string): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim()) {
      yield JSON.parse(line);
    }
  }
}

/** Return the text of the agent's last message in a Pi JSON-mode transcript, or its error. */
export async function finalMessage(transcript: string): Promise<string> {
  let final = "";

  for await (const event of events(transcript)) {
    if (event.type === "message_end" && event.message.role === "assistant") {
      const message = event.message;
      const text = message.content.filter((block: any) => block.type === "text").map((block: any) => block.text).join("");
      final = text || (message.errorMessage ?? "");
    }
  }

  return final;
}
