import { isNetworkError } from "../google/errors.ts";
import { cleanConfirmations, GRACE_MINUTES } from "../mail/cleanup.ts";
import { cleanupLog, schedule } from "../mail/schedule.ts";
import { loadProfile } from "../shared/config.ts";
import { isoMinute } from "../shared/dates.ts";
import { integer, number, parse } from "./args.ts";

export const io = { loadProfile, cleanConfirmations };

export async function cleanMailCommand(args: string[]): Promise<number> {
  const { values } = parse(args, {
    days: { type: "string", default: "2" },
    grace: { type: "string", default: String(GRACE_MINUTES) },
    "dry-run": { type: "boolean", default: false },
  });

  let trashed;
  try {
    trashed = await io.cleanConfirmations(io.loadProfile().tracker.sheet_id, {
      graceMinutes: number(values.grace, "--grace"),
      days: integer(values.days, "--days"),
      dryRun: values["dry-run"],
    });
  } catch (error) {
    if (!isNetworkError(error)) {
      throw error;
    }
    console.error(JSON.stringify({ time: isoMinute(), mail_cleanup: "error", explanation: String(error) }));
    return 1;
  }

  trashed.forEach((message) => console.log(JSON.stringify(message)));
  return 0;
}

export async function mailScheduleCommand(args: string[]): Promise<number> {
  const every = integer(parse(args, { every: { type: "string", default: "15" } }).values.every, "--every");
  schedule(every);
  console.log(`clean-mail now runs every ${every} minutes; its log is ${cleanupLog()}`);
  return 0;
}
