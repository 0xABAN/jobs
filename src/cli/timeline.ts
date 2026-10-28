import { join } from "node:path";

import { latestRun, runsDir } from "../runs/directory.ts";
import { timeline } from "../runs/timeline.ts";
import { parse, UsageError } from "./args.ts";

export async function timelineCommand(args: string[]): Promise<number> {
  const [runId = latestRun()] = parse(args, {}, 1).positionals;
  if (runId === undefined) {
    throw new UsageError(`no runs in ${runsDir()} yet`);
  }

  console.log(await timeline(join(runsDir(), runId)));
  return 0;
}
