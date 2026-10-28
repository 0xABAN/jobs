/**
 * The application tracker: a Google Sheet with `Apps`, `Failed`, and `Logins` tabs.
 *
 * `Apps` lists submitted applications. `Failed` holds the latest failure of each job
 * that has not succeeded, one row per URL. `Logins` lists the sites where apply agents
 * used or created an account for Adam. Every such account uses the profile's email and
 * password, so the Sheet never holds a password.
 *
 * Only this module knows the tabs' columns. `Apps` names its company column "jobs";
 * `Failed` still uses "Company".
 */

import { join } from "node:path";

import type { Result } from "./apply/result.ts";
import { paths } from "./config.ts";
import { isoDate, minute } from "./dates.ts";
import { withLock } from "./lock.ts";
import { Sheet } from "./sheets.ts";
import { atsBoard, onSite, parseUrl } from "./sites.ts";

export const APPLIED = "Apps";
export const FAILED = "Failed";
export const LOGINS = "Logins";

// Failures that settle a job: retrying cannot change them, or risks submitting twice.
export const FINAL_REASONS = new Set([
  "already_applied", "excluded_company", "banned_site", "expired", "not_eligible", "sso_required", "sensitive_request",
  "unsafe_permissions", "not_a_job_application", "email_only", "unconfirmed",
]);

/** A submitted application, as `Apps` lists it. */
export type Application = {
  company: string;
  role: string;
  applied: string;  // the date, as YYYY-MM-DD
};

export class Tracker {
  sheet: Sheet;

  constructor(sheetId: string) {
    this.sheet = new Sheet(sheetId);
  }

  /** Return why `url` must not be applied to again, or null. */
  async skipReason(url: string): Promise<string | null> {
    if ((await this.sheet.find(APPLIED, "URL", url))[0]) {
      return "already_applied";
    }

    const reason = (await this.sheet.find(FAILED, "URL", url))[1].Reason;
    return FINAL_REASONS.has(reason) ? reason : null;
  }

  /**
   * Return the applications to the employer at `url`: those whose company name appears in the URL,
   * or whose own URL went through the same application site.
   *
   * Comparing letters alone finds "Akuna Capital" in job-boards.greenhouse.io/akunacapital and "IMC" in
   * job-boards.eu.greenhouse.io/imc. Names shorter than three letters are skipped: "X" would match every
   * Workday URL's "XMLNAME". A site that hides the employer's name, such as Hudson River Trading's
   * Greenhouse board "wehrtyou", matches only rows that recorded a URL there, and older rows have none,
   * so an empty list proves nothing.
   */
  async earlierApplications(url: string): Promise<Application[]> {
    const address = letters(url);
    const site = applicationSite(url);
    const applications: Application[] = [];

    for (const row of await this.sheet.rows(APPLIED)) {
      const company = letters(row.jobs ?? "");
      const sameName = company.length >= 3 && address.includes(company);
      const sameSite = site !== null && applicationSite(row.URL ?? "") === site;
      if (sameName || sameSite) {
        applications.push({ company: row.jobs ?? "", role: row.Role ?? "", applied: row.Applied ?? "" });
      }
    }

    return applications;
  }

  /** Return the company of every row in `Apps` and `Failed`. */
  async companies(): Promise<string[]> {
    const applied = (await this.sheet.rows(APPLIED)).map((row) => row.jobs ?? "");
    const failed = (await this.sheet.rows(FAILED)).map((row) => row.Company ?? "");
    return [...applied, ...failed];
  }

  /** Record a live run's result: a success in `Apps`, a failure in `Failed`. */
  async record(url: string, result: Result, runId: string): Promise<void> {
    // Workers share the Failed tab's row numbers, so they edit it one at a time.
    await withLock(trackerLock(), async () => {
      const [number, failure] = await this.sheet.find(FAILED, "URL", url);

      if (result.status === "applied") {
        await this.sheet.append(APPLIED, { jobs: result.company, Role: result.role, Applied: isoDate(), Salary: result.salary, URL: url });
        if (number) {
          await this.sheet.delete(FAILED, number);
        }
        return;
      }

      const row = {
        URL: url, Company: result.company, Role: result.role, Reason: result.reason, Explanation: result.explanation,
        Attempts: Number(failure.Attempts || 0) + 1, "Last tried": minute(), Run: runId,
      };
      if (number) {
        await this.sheet.update(FAILED, number, row);
      } else {
        await this.sheet.append(FAILED, row);
      }
    });
  }

  /** Note that an agent used Adam's account on `site` today, listing the site the first time. */
  async recordAccount(site: string, email: string): Promise<void> {
    const today = isoDate();

    await withLock(trackerLock(), async () => {
      const [number, account] = await this.sheet.find(LOGINS, "Site", site);

      if (number) {
        await this.sheet.update(LOGINS, number, { ...account, "Last used": today });
      } else {
        await this.sheet.append(LOGINS, { Site: site, Email: email, "First used": today, "Last used": today });
      }
    });
  }
}

function trackerLock(): string {
  return join(paths.state, "tracker.lock");
}

function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

// Other application sites that serve many employers from one host, without boards that `atsBoard`
// tells apart. Their host would match other employers' applications, so a URL there names no site.
const SHARED_HOSTS = ["smartrecruiters.com", "workable.com", "rippling.com", "jobvite.com", "lever.co", "dover.com",
  "wellfound.com", "linkedin.com"];

/**
 * Name the employer's application site at `url`: its board on Greenhouse or Ashby, which host many
 * employers, otherwise its host. null when the URL does not show it.
 */
export function applicationSite(url: string): string | null {
  const board = atsBoard(url);
  if (board) {
    const [ats, name] = board;
    return name ? `${ats}/${name}` : null;
  }

  if (onSite(url, SHARED_HOSTS)) {
    return null;
  }

  return (parseUrl(url)?.hostname ?? "").replace(/^www\./, "") || null;
}
