import assert from "node:assert/strict";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as google from "../src/google.ts";
import { HttpError } from "../src/google.ts";
import * as mail from "../src/mail.ts";
import { classify, companyPattern } from "../src/mail.ts";
import type { Message } from "../src/mail.ts";
import { fakeFetch, replace, tempState } from "./helpers.ts";

const NOW = 1_800_000_000;
const COMPANIES = ["Neuralink", "The D. E. Shaw Group", "Ema", "NVIDIA", "Tower Research Capital", "Point72", "OpenAI",
  "Northwood Space", "IMC", "General Motors", "Anduril Industries"].map((name) => new RegExp(companyPattern(name)!));

function message(sender: string, subject: string, body = "", { minutesOld = 120, labels = [] as string[] } = {}): Message {
  return { id: "id", sender, subject, body, received: NOW - minutesOld * 60, labels };
}

const TRASHED: [Message, string][] = [
  [message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink",
    "Your application has been received and we will review it right away."), "receipt"],
  [message("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code for your application to Tower Research Capital",
    "Copy and paste this code into the security code field on your application."), "code"],
  [message("noreply@deshaw.com", "Your application to the D. E. Shaw group",
    "Your application has been successfully submitted."), "receipt"],
  [message("NVIDIA HR <nvidia@myworkday.com>", "Thank you for your interest in NVIDIA",
    "We want to confirm that your application for the JR2023492 role has been received."), "receipt"],
  // Receipt boilerplate is neither a decision nor an invitation.
  [message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink",
    "We will be in touch. If you are not selected for this position, keep an eye on our jobs page."), "receipt"],
  [message("OpenAI Hiring Team <no-reply@openai.com>", "Thank you for applying to OpenAI",
    "We received your application. In the meantime, we invite you to learn more about our hiring philosophy."), "receipt"],
  [message("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code for your application to Point72",
    "Copy and paste this code into the security code field on your application."), "code"],
  // Receipt boilerplate that mentions other candidates or an assessment only conditionally.
  [message("no-reply@anduril.com", "Your Application to Anduril",
    "We've received your application. If we're further along in the process or other candidates have "
    + "experiences better aligned to the role, you may not hear from us right away."), "receipt"],
  [message("generalmotors@myworkday.com", "Your application to 2027 Summer Intern",
    "Thanks for applying to GM. If you are applying to a role that requires coding skills, you may receive "
    + "an invitation to take a coding assessment."), "receipt"],
  // The company named only in the opening lines, and a campus team mailbox.
  [message("Northwood Hiring Team <no-reply@ashbyhq.com>", "Thank you for your application!",
    "Adam, Thank you for applying to the Software Engineering Intern role at Northwood Space."), "receipt"],
  [message("campusus@imc.com", "We've got it! Your application for Graduate Quantitative Researcher",
    "Thank you for applying to the role at IMC Trading! We have received your application."), "receipt"],
];

for (const [mail, reason] of TRASHED) {
  test(`a finished run's ${reason} is trashed: ${mail.subject}`, () => {
    assert.equal(classify(mail, COMPANIES, NOW, 60), reason);
  });
}

const KEPT: Message[] = [
  // A rejection, whatever its subject.
  message("NVIDIA HR <nvidia@myworkday.com>", "Thank you from NVIDIA",
    "Thank you for your interest. We have decided not to move forward with your application."),
  message("no-reply-recruiting@spacex.com", "Thank you for applying to Neuralink",
    "Thank you for applying. We will not be moving forward with your application at this time."),
  message("no-reply@ashbyhq.com", "Thank you for applying to OpenAI",
    "Thanks for applying. You have not been selected for this role."),
  message("no-reply@ashbyhq.com", "Thank you for applying to OpenAI",
    "We received your application and would like to invite you to an interview."),
  // A request hidden in a conditional sentence still keeps the message, as does a plain decision.
  message("no-reply@ashbyhq.com", "Thank you for applying to Neuralink",
    "Thanks for applying! If you're still interested, please schedule a time with our recruiter."),
  message("no-reply@anduril.com", "Your Application to Anduril",
    "Thank you for applying. We have decided to move forward with other candidates."),
  message("generalmotors@myworkday.com", "Your application to 2027 Summer Intern",
    "Thanks for applying to GM. You have been invited to complete a coding assessment by Friday."),
  // An assessment invitation that looks like a receipt.
  message("no-reply@ashbyhq.com", "Neuralink | Confirmation on your Application + CodeSignal",
    "Thanks for applying! Please complete the CodeSignal assessment."),
  // A code a running agent may still need.
  message("no-reply@us.greenhouse-mail.io", "Security code for your application to Neuralink", "", { minutesOld: 10 }),
  // A recruiter's reply, starred mail, and a person writing.
  message("no-reply@us.greenhouse-mail.io", "Re: Thank you for applying to Neuralink", "Your application was received."),
  message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink", "Your application was received.",
    { labels: ["STARRED"] }),
  message("Jane Doe <jane@neuralink.com>", "Thank you for applying to Neuralink", "We received your application."),
  // A company outside the tracker, and an unrelated code; "Ema" must not match "email".
  message("noreply@cs.cornell.edu", "Thank you for applying to Cornell", "We have received your application."),
  message("United <notifications@united.com>", "Here's your verification code", "Your code is 123456."),
  message("Apple <no-reply@email.apple.com>", "Thanks for applying", "We received your application."),
];

for (const mail of KEPT) {
  test(`everything else is kept: ${mail.sender}, ${mail.subject}`, () => {
    assert.equal(classify(mail, COMPANIES, NOW, 60), null);
  });
}

test("company patterns match whole words with or without spaces", () => {
  assert.equal(companyPattern("The D. E. Shaw Group"), "\\bd[\\W_]*e[\\W_]*shaw\\b");
  assert.equal(companyPattern("X"), null);
});

test("Gmail calls wait out the per-minute quota", async (t) => {
  const waits: number[] = [];
  const replies = [[403, '{"error": {"message": "Quota exceeded for quota metric"}}'] as [number, string], 429, { id: "m1" }];
  replace(t, globalThis, "fetch", fakeFetch(replies) as typeof fetch);
  replace(t, google.io, "accessToken", async () => "token");
  replace(t, google.io, "sleep", async (seconds) => void waits.push(seconds));

  assert.deepEqual(await mail.gmail("GET", "/messages/m1"), { id: "m1" });
  assert.deepEqual(waits, [2, 4]);

  // A 403 that is about permissions, not quota, throws at once.
  replies.push([403, '{"error": {"message": "Insufficient Permission"}}']);
  await assert.rejects(mail.gmail("POST", "/messages/m1/trash"), HttpError);
});

test("apply cleans at most every ten minutes", async (t) => {
  const state = tempState(t);
  const graces: number[] = [];
  replace(t, mail.io, "cleanConfirmations", async (_sheetId, { graceMinutes }) => {
    graces.push(graceMinutes);
    return [{ id: "m", reason: "receipt", from: "", subject: "" }];
  });

  assert.equal((await mail.cleanNowAndThen("sheet"))?.length, 1);
  assert.equal(await mail.cleanNowAndThen("sheet"), null);  // cleaned a moment ago

  const elevenMinutesAgo = new Date(Date.now() - 11 * 60_000);
  utimesSync(join(state, "mail-cleaned"), elevenMinutesAgo, elevenMinutesAgo);
  assert.equal((await mail.cleanNowAndThen("sheet"))?.length, 1);
  assert.deepEqual(graces, [mail.GRACE_MINUTES, mail.GRACE_MINUTES]);
});
