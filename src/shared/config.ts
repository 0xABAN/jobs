import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const paths = {
  profile: join(REPO_ROOT, "profile.json"),
  chromeProfile: join(homedir(), ".jobs/chrome"),
  state: join(homedir(), ".jobs"),
};

export const BANNED_SITES = ["lever.co"];

export const SESSION_WORKERS = new Map<number, readonly string[]>([
  [4, ["ycombinator.com", "workatastartup.com"]],
  [5, ["jobs.apple.com", "careers.microsoft.com"]],
]);

export type Profile = {
  personal: { email: string; email_by_employer?: Record<string, string>; [field: string]: unknown };
  tracker: { sheet_id: string };
  [section: string]: unknown;
};

export function statePath(...parts: string[]): string {
  return join(paths.state, ...parts);
}

export function loadProfile(path = paths.profile): Profile {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function emailFor(profile: Profile, company: string | null): string {
  const employerEmails = Object.entries(profile.personal.email_by_employer ?? {});
  const match = employerEmails.find(([employer]) => company?.toLowerCase().includes(employer.toLowerCase()));
  return match ? match[1] : profile.personal.email;
}

export function env(name: string): string | null {
  const path = join(REPO_ROOT, ".env");
  if (!existsSync(path)) {
    return null;
  }

  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [key, ...value] = line.split("=");
    if (key.trim() === name) {
      return value.join("=").trim() || null;
    }
  }

  return null;
}
