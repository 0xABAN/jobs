import type { Message } from "../google/gmail.ts";

const RECEIPT = new RegExp(
  "thank(s| you) for (applying|your application|your interest|submitting)|application (was |has been )?(received|submitted)"
  + "|(we('ve| have)?) (received|got) (it|your)|successfully submitted|received your (application|resume)"
  + "|your application (to|for) .* (has been|was) (received|submitted)", "i");

const CODE = new RegExp("security code for your application|verify your (candidate account|email)|confirm your email"
  + "|reset your password for your candidate account", "i");

const JOB_CONTEXT = /appl(y|ying|ied|ication)|resume|candida|position|role\b|career/i;

const REQUESTED_ACTION = new RegExp(
  "schedule (a|an|your) (call|chat|time)|(book|pick|select|choose) a time|calendly"
  + "|invit(e|ing) you to (an? |our )?(interview|chat|call|meet|speak|complete|take|schedule|next)"
  + "|invitation to (an? )?(interview|assessment|chat|call)|interview invitation"
  + "|codesignal|hackerrank|codility|karat|coderpad|coding (challenge|test|exercise)|take-?home"
  + "|action required|additional (info|information) (is )?requested|complete (your|the) (assessment|profile|application)"
  + "|offer letter|next round|phone screen", "i");

const DECISION = new RegExp(
  "unfortunately|not (to |be )?(move|moving|proceed|proceeding) forward|won'?t be (moving|proceeding)"
  + "|decided (not )?to|regret|other candidates|(have|has|were|was) not (been )?selected|chosen to|not the right fit"
  + "|position has been filled|no longer (considering|available)|assessment", "i");

const HEDGED = /^\W*if\b|\bif (you|we|your|there|it)\b|\b(may|might) (receive|be (contacted|asked|invited)|not hear|hear)/i;

const ATS_SENDER = new RegExp("greenhouse-mail\\.io|ashbyhq\\.com|workday\\.com|eightfold\\.ai|workablemail\\.com|icims\\.com"
  + "|smartrecruiters|successfactors|oraclecloud\\.com|jobvite|gem\\.com", "i");

const AUTOMATED_SENDER = new RegExp(ATS_SENDER.source + "|myworkdayjobs\\.com|no-?reply|do-?not-?reply|donotreply|notifications?@"
  + "|recruiting|careers|talent|hiring|campus|university|early-?careers|jobs@|apply@", "i");

const REPLY_OR_FORWARD = /^\s*(re|fwd?):/i;

const COMPANY_FILLER_WORDS = new RegExp("\\b(the|inc|incorporated|group|technologies|technology|industries|labs|systems|corporation"
  + "|company|co|llc|ltd|holdings)\\b", "gi");

const MIN_COMPANY_LETTERS = 3;
const OPENING_CHARACTERS = 500;

export type Disposal = "receipt" | "code";

export function classify(message: Message, companies: Iterable<RegExp>, now: number, graceMinutes: number): Disposal | null {
  const tooRecent = now - message.received < graceMinutes * 60;
  const personal = message.labels.includes("STARRED") || REPLY_OR_FORWARD.test(message.subject);
  if (tooRecent || personal || !AUTOMATED_SENDER.test(message.sender)) {
    return null;
  }

  const text = `${message.subject}\n${message.body}`;
  if (needsAttention(text) || !namesTrackedCompany(message, companies)) {
    return null;
  }

  if (isSecurityCode(message)) {
    return "code";
  }
  if (RECEIPT.test(text) && JOB_CONTEXT.test(text)) {
    return "receipt";
  }
  return null;
}

export function companyPattern(name: string): string | null {
  const words = name.toLowerCase().replace(COMPANY_FILLER_WORDS, " ").match(/[a-z0-9]+/g) ?? [];
  if (words.join("").replace(/[0-9]/g, "").length < MIN_COMPANY_LETTERS) {
    return null;
  }
  return "\\b" + words.join("[\\W_]*") + "\\b";
}

function needsAttention(text: string): boolean {
  const decided = sentences(text).some((sentence) => !HEDGED.test(sentence) && DECISION.test(sentence));
  return decided || REQUESTED_ACTION.test(text);
}

function namesTrackedCompany(message: Message, companies: Iterable<RegExp>): boolean {
  const opening = `${message.sender} ${message.subject} ${message.body.slice(0, OPENING_CHARACTERS)}`.toLowerCase();
  return [...companies].some((company) => company.test(opening));
}

function isSecurityCode(message: Message): boolean {
  const aboutApplication = message.subject.toLowerCase().includes("application") || ATS_SENDER.test(message.sender);
  return CODE.test(message.subject) && aboutApplication;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/);
}
