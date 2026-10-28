/** Command-line entry point: `./jobs <command>`. */

import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { apply, runsDir } from "./apply/launcher.ts";
import { timeline } from "./apply/timeline.ts";
import { running } from "./apply/workers.ts";
import { launch } from "./chrome.ts";
import { loadProfile, paths } from "./config.ts";
import { minute } from "./dates.ts";
import { authorize as authorizeGoogle, isNetworkError } from "./google.ts";
import { authorize as authorizeGmail, cleanConfirmations, cleanNowAndThen, cleanupLog, GRACE_MINUTES, schedule } from "./mail.ts";
import * as pi from "./pi.ts";
import { SCOPES as SHEETS_SCOPES, TOKEN as SHEETS_TOKEN } from "./sheets.ts";

const USAGE = `usage: ./jobs <command> [options]

  apply <url> ...       apply to jobs in parallel; print one JSON result per job
    --dry-run             fill everything but do not submit
    --workers <n>         parallel workers, shared by every run (default 6)
    --first-worker <n>    number of the first worker to use, so parallel experiments keep separate workers (default 0)
    --timeout <minutes>   minutes before an agent is stopped (default 60)
    --model <model>       Pi model pattern and thinking level (default ${pi.MODEL})
  status                list the jobs workers are applying to now
  browse [url]          open the jobs Chrome profile in the background and print its pid
  timeline [run id]     show where an apply run spent its time, step by step (default: the latest run)
  clean-mail            move automated application receipts and codes to Gmail's Trash
    --days <n>            look back this many days (default 2)
    --grace <minutes>     skip mail younger than this, which a running agent may still read (default ${GRACE_MINUTES})
    --dry-run             list what would be trashed without trashing it
  mail-schedule         have launchd run clean-mail every few minutes
    --every <minutes>     minutes between cleanups (default 15)
  mail-auth             grant the Gmail cleanup its own token, which can move mail to Trash
  sheets-auth           grant the harness and the Sheets MCP server their token for the tracker
`;

/** A mistake on the command line: the message, then the usage, go to stderr. */
class UsageError extends Error {}

/** Collaborators that tests replace. */
export const io = { loadProfile, cleanConfirmations };

/** Run the command in `argv` and return the exit status. */
export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;

  try {
    switch (command) {
      case "apply":
        return await applyCommand(args);
      case "status":
        console.log(running().join("\n") || "No jobs running.");
        return 0;
      case "browse":
        console.log(await launch(paths.chromeProfile, parse(args, {}, 1).positionals[0] ?? "about:blank"));
        return 0;
      case "timeline":
        return await timelineCommand(args);
      case "clean-mail":
        return await cleanMailCommand(args);
      case "mail-schedule": {
        const every = integer(parse(args, { every: { type: "string", default: "15" } }).values.every, "--every");
        schedule(every);
        console.log(`clean-mail now runs every ${every} minutes; its log is ${cleanupLog()}`);
        return 0;
      }
      case "mail-auth":
        parse(args, {});
        await authorizeGmail(io.loadProfile().personal.email);
        console.log("Saved the Gmail cleanup token.");
        return 0;
      case "sheets-auth":
        parse(args, {});
        await authorizeGoogle(SHEETS_TOKEN, SHEETS_SCOPES, io.loadProfile().personal.email);
        console.log("Saved the tracker token.");
        return 0;
      case undefined:
      case "-h":
      case "--help":
        console.log(USAGE);
        return command === undefined ? 2 : 0;
      default:
        throw new UsageError(`unknown command: ${command}`);
    }
  } catch (error) {
    // parseArgs reports unknown options and missing values as TypeErrors with these codes.
    const code = (error as { code?: string }).code ?? "";
    if (error instanceof UsageError || code.startsWith("ERR_PARSE_ARGS")) {
      console.error(`jobs: ${(error as Error).message}\n\n${USAGE}`);
      return 2;
    }
    throw error;
  }
}

async function applyCommand(args: string[]): Promise<number> {
  const { values, positionals } = parse(args, {
    "dry-run": { type: "boolean", default: false },
    workers: { type: "string", default: "6" },
    "first-worker": { type: "string", default: "0" },
    timeout: { type: "string", default: "60" },
    model: { type: "string", default: pi.MODEL },
  }, Infinity);

  const urls = [...new Set(positionals)];  // each URL once, in order
  if (!urls.length) {
    throw new UsageError("apply needs at least one job URL");
  }
  const workers = integer(values.workers, "--workers");
  const options = {
    dryRun: values["dry-run"], workers, firstWorker: integer(values["first-worker"], "--first-worker"),
    timeoutMinutes: number(values.timeout, "--timeout"), model: values.model,
  };

  // Stop the agents an interrupted command leaves behind, rather than let them fill forms unrecorded.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      pi.stopAgents();
      process.exit(130);
    });
  }

  const statuses = await mapConcurrently(urls, workers, async (url) => {
    let outcome: { status: string; [field: string]: unknown };
    try {
      outcome = await apply(url, options);
    } catch (error) {  // report it and let the other jobs finish
      outcome = { status: "error", explanation: String(error) };
    }

    console.log(JSON.stringify({ url, ...outcome }));
    await cleanMailAfter();
    return outcome.status;
  });

  return statuses.some((status) => status === "failed" || status === "error") ? 1 : 0;
}

/** Trash finished runs' receipts and codes now and then; report on stderr, so stdout keeps one line per job. */
async function cleanMailAfter(): Promise<void> {
  let trashed;
  try {
    trashed = await cleanNowAndThen(io.loadProfile().tracker.sheet_id);
  } catch (error) {  // the jobs went through either way; say so and keep applying
    console.error(JSON.stringify({ mail_cleanup: "error", explanation: String(error) }));
    return;
  }

  if (trashed?.length) {
    console.error(JSON.stringify({ mail_cleanup: "trashed", messages: trashed.length }));
  }
}

async function cleanMailCommand(args: string[]): Promise<number> {
  const { values } = parse(args, {
    days: { type: "string", default: "2" },
    grace: { type: "string", default: String(GRACE_MINUTES) },
    "dry-run": { type: "boolean", default: false },
  });

  let trashed;
  try {
    trashed = await io.cleanConfirmations(io.loadProfile().tracker.sheet_id, {
      graceMinutes: number(values.grace, "--grace"), days: integer(values.days, "--days"), dryRun: values["dry-run"],
    });
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }

    // Offline after the Mac wakes, DNS failures, and timeouts: report it in one line; the next
    // scheduled run tries again.
    console.error(JSON.stringify({ time: minute(), mail_cleanup: "error", explanation: String(error) }));
    return 1;
  }

  for (const message of trashed) {
    console.log(JSON.stringify(message));
  }
  return 0;
}

async function timelineCommand(args: string[]): Promise<number> {
  const runId = parse(args, {}, 1).positionals[0] ?? readdirSync(runsDir()).sort().at(-1);
  if (runId === undefined) {
    throw new UsageError(`no runs in ${runsDir()} yet`);
  }

  console.log(await timeline(join(runsDir(), runId)));
  return 0;
}

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

/** Parse a command's options, allowing at most `maxPositionals` arguments besides them. */
function parse<T extends Options>(args: string[], options: T, maxPositionals = 0) {
  const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  if (parsed.positionals.length > maxPositionals) {
    throw new UsageError(`unexpected argument: ${parsed.positionals[maxPositionals]}`);
  }
  return parsed;
}

function number(value: string, option: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw new UsageError(`${option} takes a number, not ${JSON.stringify(value)}`);
  }
  return parsed;
}

function integer(value: string, option: string): number {
  const parsed = number(value, option);
  if (!Number.isInteger(parsed)) {
    throw new UsageError(`${option} takes a whole number, not ${value}`);
  }
  return parsed;
}

/** Run `task` on every item with at most `limit` running at once, starting them in order; return the results in order. */
async function mapConcurrently<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;

  const lane = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, lane));

  return results;
}

// Run when Node starts this file, not when tests import it.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
