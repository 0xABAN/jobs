/**
 * Render the prompt for one job application.
 *
 * `prompt.md` holds the rules with `${name}` placeholders, which are filled here; `$$` is a
 * literal dollar sign. Adam's profile is embedded as JSON; the agent reads the resume it chooses itself.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BANNED_SITES, REPO_ROOT } from "../config.ts";
import type { Profile } from "../config.ts";
import { usDate } from "../dates.ts";
import type { Application } from "../tracker.ts";

const TEMPLATE_PATH = join(dirname(fileURLToPath(import.meta.url)), "prompt.md");

type PromptOptions = {
  dryRun: boolean;
  profile: Profile;
  today: Date;
  chromePid: number;
  capsolverKey: string | null;
  earlierApplications?: Application[];
};

/**
 * Return the complete prompt for applying to one job in the Chrome the launcher opened.
 *
 * The agent solves CAPTCHAs with CapSolver itself, as ApplyPilot's agents do, so the prompt
 * carries `capsolverKey`. Without one, it tells the agent to solve them by hand.
 *
 * `earlierApplications` are Adam's applications to this employer in the tracker, so the agent can
 * answer "Have you applied here before?" truthfully. Without any, the prompt says nothing: the
 * tracker cannot match every employer, so an empty list is no evidence of a first application.
 */
export function renderPrompt(jobUrl: string, options: PromptOptions): string {
  const { dryRun, profile, today, chromePid, capsolverKey, earlierApplications = [] } = options;

  let history = "";
  if (earlierApplications.length) {
    const listed = earlierApplications.map((app) => `  - ${app.company}: ${app.role} (${app.applied})`).join("\n");
    history = `- **Adam's earlier applications to this employer**, from his tracker:\n${listed}`;
  }

  // A stray Return can submit a form; on Greenhouse that only sends a security code, and
  // entering it would complete a real application.
  const runMode = dryRun
    ? "**Dry run:** do everything except the final submit click, and finish with status `dry_run`. "
      + "If the site asks for a security or verification code, the form was submitted by accident: "
      + "never enter the code; finish with status `dry_run` and say so in the explanation."
    : "**Live run:** submit the application once every check in step 7 passes.";

  // The launcher, not the agent, keeps the tracker.
  const { tracker, ...shared } = profile;

  return substitute(readFileSync(TEMPLATE_PATH, "utf8"), {
    job_url: jobUrl,
    run_mode: runMode,
    today: usDate(today),
    repo_root: REPO_ROOT,
    chrome_pid: chromePid,
    capsolver_key: capsolverKey ?? "",
    capsolver_key_note: capsolverKey ? `\`${capsolverKey}\`` : "NOT CONFIGURED: skip to Manual fallback for all CAPTCHAs",
    banned_sites: BANNED_SITES.join(", "),
    earlier_applications: history,
    profile: JSON.stringify(shared, null, 2),
  });
}

/**
 * Fill `template`'s `${name}` and `$name` placeholders from `values`; `$$` is a literal dollar sign.
 *
 * A stray `$` or a placeholder without a value throws, so a mistake in `prompt.md` never reaches an agent.
 */
function substitute(template: string, values: Record<string, string | number>): string {
  return template.replace(
    /\$(?:(\$)|([_a-z][_a-z0-9]*)|\{([_a-z][_a-z0-9]*)\}|)/gi,
    (_match, escaped: string | undefined, named: string | undefined, braced: string | undefined, offset: number) => {
      if (escaped) {
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
    },
  );
}
