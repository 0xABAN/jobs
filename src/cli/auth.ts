import { authorizeCleanup } from "../google/gmail.ts";
import { authorize } from "../google/oauth.ts";
import { SCOPES as SHEETS_SCOPES, TOKEN as SHEETS_TOKEN } from "../google/sheets.ts";
import { loadProfile } from "../shared/config.ts";
import { parse } from "./args.ts";

export async function mailAuthCommand(args: string[]): Promise<number> {
  parse(args, {});
  await authorizeCleanup(loadProfile().personal.email);
  console.log("Saved the Gmail cleanup token.");
  return 0;
}

export async function sheetsAuthCommand(args: string[]): Promise<number> {
  parse(args, {});
  await authorize(SHEETS_TOKEN, SHEETS_SCOPES, loadProfile().personal.email);
  console.log("Saved the tracker token.");
  return 0;
}
