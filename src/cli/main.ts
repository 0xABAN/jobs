import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MODEL } from "../agent/settings.ts";
import { GRACE_MINUTES } from "../mail/cleanup.ts";
import { applyCommand, statusCommand } from "./apply.ts";
import { isUsageError, UsageError } from "./args.ts";
import { mailAuthCommand, sheetsAuthCommand } from "./auth.ts";
import { browseCommand } from "./browse.ts";
import { cleanMailCommand, mailScheduleCommand } from "./mail.ts";
import { timelineCommand } from "./timeline.ts";

const USAGE = `usage: ./jobs <command> [options]

  apply <url> ...       apply to jobs in parallel; print one JSON result per job
    --dry-run             fill everything but do not submit
    --workers <n>         parallel workers, shared by every run (default 6)
    --first-worker <n>    number of the first worker to use, so parallel experiments keep separate workers (default 0)
    --timeout <minutes>   minutes before an agent is stopped (default 60)
    --model <model>       Pi model pattern and thinking level (default ${MODEL})
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

const COMMANDS: Record<string, (args: string[]) => Promise<number>> = {
  apply: applyCommand,
  status: statusCommand,
  browse: browseCommand,
  timeline: timelineCommand,
  "clean-mail": cleanMailCommand,
  "mail-schedule": mailScheduleCommand,
  "mail-auth": mailAuthCommand,
  "sheets-auth": sheetsAuthCommand,
};

const USAGE_ERROR = 2;

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === undefined || command === "-h" || command === "--help") {
    console.log(USAGE);
    return command === undefined ? USAGE_ERROR : 0;
  }

  try {
    const handler = COMMANDS[command];
    if (!handler) {
      throw new UsageError(`unknown command: ${command}`);
    }
    return await handler(args);
  } catch (error) {
    if (!isUsageError(error)) {
      throw error;
    }
    console.error(`jobs: ${(error as Error).message}\n\n${USAGE}`);
    return USAGE_ERROR;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
