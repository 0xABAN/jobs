import type { Result } from "../apply/result.ts";
import { Sheet } from "../google/sheets.ts";
import type { SheetRow } from "../google/sheets.ts";
import { statePath } from "../shared/config.ts";
import { isoDate, isoMinute } from "../shared/dates.ts";
import { withLock } from "../shared/lock.ts";
import { applicationSite, namesCompany } from "./matching.ts";

export const APPLIED = "Apps";
export const FAILED = "Failed";
export const LOGINS = "Logins";

export const FINAL_REASONS = new Set([
  "already_applied", "excluded_company", "banned_site", "expired", "not_eligible", "sso_required", "sensitive_request",
  "unsafe_permissions", "not_a_job_application", "email_only", "unconfirmed",
]);

export type Application = {
  company: string;
  role: string;
  applied: string;
};

export class Tracker {
  sheet: Sheet;

  constructor(sheetId: string) {
    this.sheet = new Sheet(sheetId);
  }

  async skipReason(url: string): Promise<string | null> {
    const [applied] = await this.sheet.find(APPLIED, "URL", url);
    if (applied) {
      return "already_applied";
    }

    const [, failure] = await this.sheet.find(FAILED, "URL", url);
    return FINAL_REASONS.has(failure.Reason) ? failure.Reason : null;
  }

  async earlierApplications(url: string): Promise<Application[]> {
    const site = applicationSite(url);
    const sameEmployer = (row: SheetRow) =>
      namesCompany(url, row.jobs ?? "") || (site !== null && applicationSite(row.URL ?? "") === site);

    return (await this.sheet.rows(APPLIED)).filter(sameEmployer).map(application);
  }

  async companies(): Promise<string[]> {
    const applied = (await this.sheet.rows(APPLIED)).map((row) => row.jobs ?? "");
    const failed = (await this.sheet.rows(FAILED)).map((row) => row.Company ?? "");
    return [...applied, ...failed];
  }

  async record(url: string, result: Result, runId: string): Promise<void> {
    await withLock(trackerLock(), async () => {
      const [failedRow, failure] = await this.sheet.find(FAILED, "URL", url);

      if (result.status === "applied") {
        await this.sheet.append(APPLIED, { jobs: result.company, Role: result.role, Applied: isoDate(), Salary: result.salary, URL: url });
        if (failedRow) {
          await this.sheet.delete(FAILED, failedRow);
        }
        return;
      }

      const row = {
        URL: url, Company: result.company, Role: result.role, Reason: result.reason, Explanation: result.explanation,
        Attempts: Number(failure.Attempts || 0) + 1, "Last tried": isoMinute(), Run: runId,
      };
      if (failedRow) {
        await this.sheet.update(FAILED, failedRow, row);
      } else {
        await this.sheet.append(FAILED, row);
      }
    });
  }

  async recordAccount(site: string, email: string): Promise<void> {
    const today = isoDate();

    await withLock(trackerLock(), async () => {
      const [loginRow, account] = await this.sheet.find(LOGINS, "Site", site);
      if (loginRow) {
        await this.sheet.update(LOGINS, loginRow, { ...account, "Last used": today });
      } else {
        await this.sheet.append(LOGINS, { Site: site, Email: email, "First used": today, "Last used": today });
      }
    });
  }
}

function application(row: SheetRow): Application {
  return { company: row.jobs ?? "", role: row.Role ?? "", applied: row.Applied ?? "" };
}

function trackerLock(): string {
  return statePath("tracker.lock");
}
