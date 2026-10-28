import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { REPO_ROOT, statePath } from "../shared/config.ts";

const LABEL = "dev.jobs.clean-mail";
const PLIST = join(homedir(), `Library/LaunchAgents/${LABEL}.plist`);
const ENTRY_POINT = join(REPO_ROOT, "src/cli/main.ts");
const OWNER_ONLY_UMASK = 0o077;

export function cleanupLog(): string {
  return statePath("mail-cleanup.log");
}

export function schedule(everyMinutes: number): void {
  const job = {
    Label: LABEL,
    ProgramArguments: [process.execPath, "--disable-warning=ExperimentalWarning", ENTRY_POINT, "clean-mail"],
    WorkingDirectory: REPO_ROOT,
    StartInterval: everyMinutes * 60,
    RunAtLoad: true,
    Umask: OWNER_ONLY_UMASK,
    StandardOutPath: cleanupLog(),
    StandardErrorPath: cleanupLog(),
  };

  writeFileSync(PLIST, JSON.stringify(job));
  execFileSync("plutil", ["-convert", "xml1", PLIST]);

  const domain = `gui/${process.getuid!()}`;
  spawnSync("launchctl", ["bootout", `${domain}/${LABEL}`]);
  execFileSync("launchctl", ["bootstrap", domain, PLIST]);
}
