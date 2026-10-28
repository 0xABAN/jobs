import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { statePath } from "../shared/config.ts";

const LOGS_KEPT_HOURS = 3;
const KEPT_FILE = "result.json";

export function runsDir(): string {
  return statePath("runs");
}

export function latestRun(): string | undefined {
  return existsSync(runsDir()) ? readdirSync(runsDir()).sort().at(-1) : undefined;
}

export function pruneLogs(): void {
  if (!existsSync(runsDir())) {
    return;
  }

  const cutoff = Date.now() - LOGS_KEPT_HOURS * 3_600_000;
  for (const run of readdirSync(runsDir(), { withFileTypes: true })) {
    if (!run.isDirectory()) {
      continue;
    }

    for (const name of readdirSync(join(runsDir(), run.name))) {
      if (name !== KEPT_FILE) {
        removeIfOlder(join(runsDir(), run.name, name), cutoff);
      }
    }
  }
}

function removeIfOlder(path: string, cutoff: number): void {
  try {
    if (statSync(path).mtimeMs < cutoff) {
      rmSync(path);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
