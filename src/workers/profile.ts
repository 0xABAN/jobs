import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { paths } from "../shared/config.ts";

const NOT_COPIED = [/^Singleton/, /^RunningChromeVersion$/, /^DevToolsActivePort$/, /Cache/, /^Service Worker$/, /^Crashpad$/];
const CONTINUE_WHERE_YOU_LEFT_OFF = 1;

export async function prepareWorker(directory: string): Promise<void> {
  mkdirSync(directory, { recursive: true });

  const chrome = join(directory, "chrome");
  if (!existsSync(chrome)) {
    await copyProfile(paths.chromeProfile, chrome);
  }
  keepSessionsWithoutSavingPasswords(join(chrome, "Default/Preferences"));
}

async function copyProfile(source: string, destination: string): Promise<void> {
  const partial = `${destination}.partial`;
  await rm(partial, { recursive: true, force: true });
  await cp(source, partial, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (path) => !NOT_COPIED.some((pattern) => pattern.test(basename(path))),
  });
  renameSync(partial, destination);
}

function keepSessionsWithoutSavingPasswords(preferencesPath: string): void {
  const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
  preferences.credentials_enable_service = false;
  (preferences.profile ??= {}).password_manager_enabled = false;
  (preferences.session ??= {}).restore_on_startup = CONTINUE_WHERE_YOU_LEFT_OFF;
  writeFileSync(preferencesPath, JSON.stringify(preferences));
}
