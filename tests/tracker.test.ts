import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { result } from "../src/apply/result.ts";
import { isoDate } from "../src/dates.ts";
import { Sheet } from "../src/sheets.ts";
import type { Row } from "../src/sheets.ts";
import { applicationSite, Tracker } from "../src/tracker.ts";
import { replace, tempState } from "./helpers.ts";

/** Answer the Sheet's reads of whole tabs from `tabs`. */
function fakeTabs(t: TestContext, tabs: Record<string, string[][]>): void {
  replace(t, Sheet.prototype, "call", async (_method: string, path: string) => ({ values: tabs[path.split("/").at(-1)!] }));
}

test("skips applied jobs and settled failures", async (t) => {
  fakeTabs(t, {
    Apps: [["jobs", "URL"], ["Acme", "https://applied"]],
    Failed: [["URL", "Reason"], ["https://settled", "not_eligible"], ["https://retryable", "timeout"]],
  });
  const tracker = new Tracker("sheet");

  assert.equal(await tracker.skipReason("https://applied"), "already_applied");
  assert.equal(await tracker.skipReason("https://settled"), "not_eligible");
  assert.equal(await tracker.skipReason("https://retryable"), null);
  assert.equal(await tracker.skipReason("https://new"), null);
});

test("lists every company in Apps and Failed", async (t) => {
  fakeTabs(t, { Apps: [["jobs", "Role"], ["Acme", "Engineer"]], Failed: [["URL", "Company"], ["https://job", "Initech"]] });

  assert.deepEqual(await new Tracker("sheet").companies(), ["Acme", "Initech"]);
});

test("finds earlier applications to the employer in its URL", async (t) => {
  fakeTabs(t, {
    Apps: [["jobs", "Role", "Applied", "URL"],
      ["IMC", "Graduate Software Engineer", "2026-09-07", ""],
      ["Akuna Capital", "Junior Quant Researcher", "2026-10-04", ""],
      ["X", "Engineer", "2026-10-01", ""]],
  });
  const tracker = new Tracker("sheet");

  assert.deepEqual(await tracker.earlierApplications("https://job-boards.eu.greenhouse.io/imc/jobs/4842595101"), [
    { company: "IMC", role: "Graduate Software Engineer", applied: "2026-09-07" }]);
  assert.deepEqual((await tracker.earlierApplications("https://job-boards.greenhouse.io/akunacapital/jobs/1")).map((app) => app.company), [
    "Akuna Capital"]);
  // Two-letter names would match unrelated URLs, such as every Workday URL's XMLNAME.
  assert.deepEqual(await tracker.earlierApplications("https://acme.wd5.myworkdayjobs.com/job/XMLNAME-2027"), []);
});

test("finds earlier applications through the same application site", async (t) => {
  fakeTabs(t, {
    Apps: [["jobs", "Role", "Applied", "URL"],
      ["Hudson River Trading", "Data Scientist Intern", "2026-10-05", "https://job-boards.greenhouse.io/wehrtyou/jobs/8257369"],
      ["Stripe", "Software Engineer, Intern", "2026-10-05", "https://job-boards.greenhouse.io/stripe/jobs/8128745"],
      ["Notion", "Software Engineer", "2026-10-01", "https://jobs.ashbyhq.com/notion/1"],
      ["Hidden", "Engineer", "2026-10-01", "https://app.greenhouse.io/embed/job_app?token=1"]],
  });
  const tracker = new Tracker("sheet");

  // The board "wehrtyou" does not name Hudson River Trading, but the earlier row went through it.
  assert.deepEqual((await tracker.earlierApplications("https://boards.greenhouse.io/wehrtyou/jobs/1")).map((app) => app.role), [
    "Data Scientist Intern"]);
  // A URL that hides its board matches no one through the site alone, nor does a host many employers share.
  assert.deepEqual(await tracker.earlierApplications("https://app.greenhouse.io/embed/job_app?token=2"), []);
  assert.equal(applicationSite("https://jobs.smartrecruiters.com/ServiceNow/1"), null);
});

test("records the company under the Apps header", async (t) => {
  tempState(t);
  const writes: [string, unknown][] = [];
  replace(t, Sheet.prototype, "call", async (method: string, path: string, body?: unknown) => {
    if (method === "POST") {
      writes.push([path, body]);
      return {};
    }
    if (path === "/values/Failed") {
      return { values: [["URL", "Reason"]] };
    }
    assert.equal(path, "/values/Apps%211%3A1");
    return { values: [["jobs", "Role", "Applied", "Salary", "fantastic.jobs Id", "URL"]] };
  });

  await new Tracker("sheet").record("https://job", result("applied", null, "Receipt confirmed", {
    company: "Acme", role: "Engineer", salary: "$100,000",
  }), "run-1");

  assert.deepEqual(writes, [["/values/Apps:append?valueInputOption=RAW", {
    values: [["Acme", "Engineer", isoDate(), "$100,000", "", "https://job"]],
  }]]);
});

test("lists each account site once", async (t) => {
  tempState(t);
  const rows: Row[] = [{ Site: "old.wd5.myworkdayjobs.com", Email: "a@x.com", "First used": "2026-01-01", "Last used": "2026-01-01" }];
  const tracker = new Tracker("sheet");
  tracker.sheet = {
    async find(_tab: string, column: string, value: string) {
      const index = rows.findIndex((row) => row[column] === value);
      return index === -1 ? [null, {}] : [index + 2, rows[index]];
    },
    async append(_tab: string, row: Row) {
      rows.push(row);
    },
    async update(_tab: string, number: number, row: Row) {
      rows[number - 2] = row;
    },
  } as unknown as Sheet;
  const today = isoDate();

  await tracker.recordAccount("old.wd5.myworkdayjobs.com", "a@x.com");
  await tracker.recordAccount("new.wd1.myworkdayjobs.com", "a@x.com");

  assert.deepEqual(rows, [
    { Site: "old.wd5.myworkdayjobs.com", Email: "a@x.com", "First used": "2026-01-01", "Last used": today },
    { Site: "new.wd1.myworkdayjobs.com", Email: "a@x.com", "First used": today, "Last used": today },
  ]);
});
