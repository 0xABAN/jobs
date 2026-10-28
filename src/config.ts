/** Where the harness keeps its files, which sites it avoids, and how it reads Adam's profile. */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Files and directories the harness reads and writes outside its source. Tests point them at temporary ones. */
export const paths = {
  // Adam's answers. Gitignored; profile.example.json documents the shape.
  profile: join(REPO_ROOT, "profile.json"),

  // The Chrome user-data directory the agent applies from; it keeps Adam's job-site logins.
  chromeProfile: join(homedir(), "Library/Application Support/CuaDriver/BrowserProfiles/jobs"),

  // Runtime state lives outside the repo: Pi loads AGENTS.md from every parent of its working directory.
  state: join(homedir(), ".jobs"),
};

// Application sites the harness never applies on, with their subdomains. Lever guards its forms
// with an hCaptcha that CapSolver cannot solve.
export const BANNED_SITES = ["lever.co"];

// Workers whose Chrome holds Adam's own sign-in to a site that agents never sign in to themselves,
// keyed by worker number. Jobs on those sites run only there, and other jobs leave those workers free.
export const SESSION_WORKERS = new Map<number, readonly string[]>([
  [4, ["ycombinator.com", "workatastartup.com"]],
  [5, ["jobs.apple.com", "careers.microsoft.com"]],
]);

/** Adam's answers, as `profile.example.json` shows them. Only the fields the harness itself reads are typed. */
export type Profile = {
  personal: { email: string; email_by_employer?: Record<string, string>; [field: string]: unknown };
  tracker: { sheet_id: string };
  [section: string]: unknown;
};

/** Read a profile file. */
export function loadProfile(path = paths.profile): Profile {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Return the email Adam applies with at `company`: his `email_by_employer` entry for it, else his main email.
 *
 * An entry matches when its key appears in the company's name, ignoring case, so "NVIDIA" covers "NVIDIA Corporation".
 */
export function emailFor(profile: Profile, company: string | null): string {
  const personal = profile.personal;

  for (const [employer, email] of Object.entries(personal.email_by_employer ?? {})) {
    if (company && company.toLowerCase().includes(employer.toLowerCase())) {
      return email;
    }
  }

  return personal.email;
}

/** Return a secret from the repo's gitignored `.env` file, or null when the file does not set it. */
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
