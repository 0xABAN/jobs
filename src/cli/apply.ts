import { stopAgents } from "../agent/pi.ts";
import { MODEL } from "../agent/settings.ts";
import { apply } from "../apply/apply.ts";
import type { ApplyOptions } from "../apply/apply.ts";
import { cleanNowAndThen } from "../mail/cleanup.ts";
import { mapConcurrently } from "../shared/concurrency.ts";
import { loadProfile } from "../shared/config.ts";
import { running } from "../workers/claims.ts";
import { integer, number, parse, UsageError } from "./args.ts";

const INTERRUPTED = 130;

export async function applyCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    "dry-run": { type: "boolean", default: false },
    workers: { type: "string", default: "6" },
    "first-worker": { type: "string", default: "0" },
    timeout: { type: "string", default: "60" },
    model: { type: "string", default: MODEL },
  }, Infinity);

  const urls = [...new Set(positionals)];
  if (!urls.length) {
    throw new UsageError("apply needs at least one job URL");
  }

  const options: ApplyOptions = {
    dryRun: values["dry-run"],
    workers: integer(values.workers, "--workers"),
    firstWorker: integer(values["first-worker"], "--first-worker"),
    timeoutMinutes: number(values.timeout, "--timeout"),
    model: values.model,
  };

  stopAgentsWhenInterrupted();
  const statuses = await mapConcurrently(urls, options.workers, (url) => applyAndReport(url, options));
  return statuses.some((status) => status === "failed" || status === "error") ? 1 : 0;
}

export async function statusCommand(args: string[]): Promise<number> {
  parse(args, {});
  console.log(running().join("\n") || "No jobs running.");
  return 0;
}

async function applyAndReport(url: string, options: ApplyOptions): Promise<string> {
  let outcome: { status: string; [field: string]: unknown };
  try {
    outcome = await apply(url, options);
  } catch (error) {
    outcome = { status: "error", explanation: String(error) };
  }

  console.log(JSON.stringify({ url, ...outcome }));
  await cleanMailBetweenJobs();
  return outcome.status;
}

async function cleanMailBetweenJobs(): Promise<void> {
  try {
    const trashed = await cleanNowAndThen(loadProfile().tracker.sheet_id);
    if (trashed?.length) {
      console.error(JSON.stringify({ mail_cleanup: "trashed", messages: trashed.length }));
    }
  } catch (error) {
    console.error(JSON.stringify({ mail_cleanup: "error", explanation: String(error) }));
  }
}

function stopAgentsWhenInterrupted(): void {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stopAgents();
      process.exit(INTERRUPTED);
    });
  }
}
