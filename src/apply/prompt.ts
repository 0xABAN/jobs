import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BANNED_SITES, REPO_ROOT } from "../shared/config.ts";
import type { Profile } from "../shared/config.ts";
import { usDate } from "../shared/dates.ts";
import type { Application } from "../tracker/tracker.ts";

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");
const PLACEHOLDER = /\$(?:(\$)|([_a-z][_a-z0-9]*)|\{([_a-z][_a-z0-9]*)\}|)/gi;

const DRY_RUN = "**Dry run:** do everything except the final submit click, and finish with status `dry_run`. "
  + "If the site asks for a security or verification code, the form was submitted by accident: "
  + "never enter the code; finish with status `dry_run` and say so in the explanation.";
const LIVE_RUN = "**Live run:** submit the application once every check in step 7 passes.";
const NO_CAPSOLVER_KEY = "NOT CONFIGURED: skip to Manual fallback for all CAPTCHAs";

export type PromptOptions = {
  dryRun: boolean;
  profile: Profile;
  today: Date;
  chromePid: number;
  capsolverKey: string | null;
  earlierApplications?: Application[];
};

export function renderPrompt(jobUrl: string, options: PromptOptions): string {
  const { dryRun, profile, today, chromePid, capsolverKey, earlierApplications = [] } = options;
  const { tracker, ...agentProfile } = profile;

  return fillPlaceholders(readFileSync(TEMPLATE_PATH, "utf8"), {
    job_url: jobUrl,
    run_mode: dryRun ? DRY_RUN : LIVE_RUN,
    today: usDate(today),
    repo_root: REPO_ROOT,
    chrome_pid: chromePid,
    capsolver_key: capsolverKey ?? "",
    capsolver_key_note: capsolverKey ? `\`${capsolverKey}\`` : NO_CAPSOLVER_KEY,
    banned_sites: BANNED_SITES.join(", "),
    earlier_applications: earlierApplicationsSection(earlierApplications),
    profile: JSON.stringify(agentProfile, null, 2),
  });
}

function earlierApplicationsSection(applications: Application[]): string {
  if (!applications.length) {
    return "";
  }

  const listed = applications.map((app) => `  - ${app.company}: ${app.role} (${app.applied})`).join("\n");
  return `- **Adam's earlier applications to this employer**, from his tracker:\n${listed}`;
}

function fillPlaceholders(template: string, values: Record<string, string | number>): string {
  return template.replace(PLACEHOLDER, (_match, dollar?: string, named?: string, braced?: string, offset?: number) => {
    if (dollar) {
      return "$";
    }

    const name = named ?? braced;
    if (name === undefined) {
      throw new Error(`prompt.md has a stray $ at character ${offset}; write $$ for a dollar sign`);
    }
    if (!(name in values)) {
      throw new Error(`prompt.md uses \${${name}}, which has no value`);
    }
    return String(values[name]);
  });
}
