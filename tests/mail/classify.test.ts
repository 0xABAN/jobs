import assert from "node:assert/strict";
import { test } from "node:test";

import type { Message } from "../../src/google/gmail.ts";
import { classify, companyPattern } from "../../src/mail/classify.ts";

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
  [message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink",
    "We will be in touch. If you are not selected for this position, keep an eye on our jobs page."), "receipt"],
  [message("OpenAI Hiring Team <no-reply@openai.com>", "Thank you for applying to OpenAI",
    "We received your application. In the meantime, we invite you to learn more about our hiring philosophy."), "receipt"],
  [message("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code for your application to Point72",
    "Copy and paste this code into the security code field on your application."), "code"],
  [message("no-reply@anduril.com", "Your Application to Anduril",
    "We've received your application. If we're further along in the process or other candidates have "
    + "experiences better aligned to the role, you may not hear from us right away."), "receipt"],
  [message("generalmotors@myworkday.com", "Your application to 2027 Summer Intern",
    "Thanks for applying to GM. If you are applying to a role that requires coding skills, you may receive "
    + "an invitation to take a coding assessment."), "receipt"],
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

const KEPT: [Message, string][] = [
  [message("NVIDIA HR <nvidia@myworkday.com>", "Thank you from NVIDIA",
    "Thank you for your interest. We have decided not to move forward with your application."), "a rejection"],
  [message("no-reply-recruiting@spacex.com", "Thank you for applying to Neuralink",
    "Thank you for applying. We will not be moving forward with your application at this time."), "a rejection"],
  [message("no-reply@ashbyhq.com", "Thank you for applying to OpenAI",
    "Thanks for applying. You have not been selected for this role."), "a rejection"],
  [message("no-reply@ashbyhq.com", "Thank you for applying to OpenAI",
    "We received your application and would like to invite you to an interview."), "an invitation"],
  [message("no-reply@ashbyhq.com", "Thank you for applying to Neuralink",
    "Thanks for applying! If you're still interested, please schedule a time with our recruiter."), "a conditional request"],
  [message("no-reply@anduril.com", "Your Application to Anduril",
    "Thank you for applying. We have decided to move forward with other candidates."), "a decision"],
  [message("generalmotors@myworkday.com", "Your application to 2027 Summer Intern",
    "Thanks for applying to GM. You have been invited to complete a coding assessment by Friday."), "an assessment"],
  [message("no-reply@ashbyhq.com", "Neuralink | Confirmation on your Application + CodeSignal",
    "Thanks for applying! Please complete the CodeSignal assessment."), "an assessment that looks like a receipt"],
  [message("no-reply@us.greenhouse-mail.io", "Security code for your application to Neuralink", "", { minutesOld: 10 }),
    "a code a running agent may still need"],
  [message("no-reply@us.greenhouse-mail.io", "Re: Thank you for applying to Neuralink", "Your application was received."),
    "a reply"],
  [message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink", "Your application was received.",
    { labels: ["STARRED"] }), "starred mail"],
  [message("Jane Doe <jane@neuralink.com>", "Thank you for applying to Neuralink", "We received your application."),
    "a person writing"],
  [message("noreply@cs.cornell.edu", "Thank you for applying to Cornell", "We have received your application."),
    "a company outside the tracker"],
  [message("United <notifications@united.com>", "Here's your verification code", "Your code is 123456."),
    "an unrelated code"],
  [message("Apple <no-reply@email.apple.com>", "Thanks for applying", "We received your application."),
    "\"Ema\" inside \"email\""],
];

for (const [mail, why] of KEPT) {
  test(`keeps ${why}: ${mail.subject}`, () => {
    assert.equal(classify(mail, COMPANIES, NOW, 60), null);
  });
}

test("company patterns match whole words with or without spaces", () => {
  assert.equal(companyPattern("The D. E. Shaw Group"), "\\bd[\\W_]*e[\\W_]*shaw\\b");
  assert.equal(companyPattern("X"), null);
});
