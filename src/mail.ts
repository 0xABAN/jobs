/**
 * Move automated job-application mail to Gmail's Trash: receipts, security codes, and account checks.
 *
 * Every application leaves a "thank you for applying" receipt, and many leave a security-code or
 * account-verification email, which buries the mail Adam needs to read. Once no run can still be
 * reading them, `cleanConfirmations` trashes those, and only those:
 *
 * - a receipt, code, or verification email from an automated sender,
 * - naming a company in the tracker, so mail from his bank or a graduate school never qualifies,
 * - with no sign of a decision, a request, or an invitation, so rejections, assessments, and
 *   interview invites stay,
 * - and not a reply, a forward, or starred.
 *
 * Trashed mail stays recoverable in Gmail's Trash for 30 days. The cleanup has its own refresh
 * token, `.mcp/gmail-cleanup-token.json`, with the `gmail.modify` scope (which can trash but
 * never permanently delete); the apply agents' Gmail tools keep their read-only token.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { paths, REPO_ROOT } from "./config.ts";
import * as google from "./google.ts";
import type { HttpError } from "./google.ts";
import { tryLock } from "./lock.ts";
import { Tracker } from "./tracker.ts";

export const TOKEN = join(REPO_ROOT, ".mcp/gmail-cleanup-token.json");
export const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Mail younger than this stays: a running agent reads its code or receipt within a few minutes.
export const GRACE_MINUTES = 15;

// How often the apply command cleans, at most.
export const CLEAN_EVERY_MINUTES = 10;

const SCHEDULE_LABEL = "dev.jobs.clean-mail";
const SCHEDULE_PLIST = join(homedir(), `Library/LaunchAgents/${SCHEDULE_LABEL}.plist`);

/** The scheduled cleanup's log. */
export function cleanupLog(): string {
  return join(paths.state, "mail-cleanup.log");
}

// Narrows the search to candidates; `classify` decides.
const SEARCH = '-in:trash -is:starred (subject:(application OR applying OR applied OR resume OR "security code" OR verify '
  + 'OR verification OR "candidate account" OR "thank you" OR thanks OR received OR submitted OR interest))';

const RECEIPT = new RegExp(
  "thank(s| you) for (applying|your application|your interest|submitting)|application (was |has been )?(received|submitted)"
  + "|(we('ve| have)?) (received|got) (it|your)|successfully submitted|received your (application|resume)"
  + "|your application (to|for) .* (has been|was) (received|submitted)", "i");
const CODE = new RegExp("security code for your application|verify your (candidate account|email)|confirm your email"
  + "|reset your password for your candidate account", "i");
const JOB_CONTEXT = /appl(y|ying|ied|ication)|resume|candida|position|role\b|career/i;

// Requests for a step and invitations keep a message wherever they appear.
const ACTION = new RegExp(
  "schedule (a|an|your) (call|chat|time)|(book|pick|select|choose) a time|calendly"
  // Receipts "invite you to learn more about" a company; invitations ask for a step.
  + "|invit(e|ing) you to (an? |our )?(interview|chat|call|meet|speak|complete|take|schedule|next)"
  + "|invitation to (an? )?(interview|assessment|chat|call)|interview invitation"
  + "|codesignal|hackerrank|codility|karat|coderpad|coding (challenge|test|exercise)|take-?home"
  + "|action required|additional (info|information) (is )?requested|complete (your|the) (assessment|profile|application)"
  + "|offer letter|next round|phone screen", "i");

// Decisions keep a message too, but receipts mention them in hedged sentences ("If other candidates
// are better aligned, you may not hear from us"; "you may receive a coding assessment"), so these are
// looked for only in sentences that are not hedged.
const DECISION = new RegExp(
  "unfortunately|not (to |be )?(move|moving|proceed|proceeding) forward|won'?t be (moving|proceeding)"
  + "|decided (not )?to|regret|other candidates|(have|has|were|was) not (been )?selected|chosen to|not the right fit"
  + "|position has been filled|no longer (considering|available)|assessment", "i");
const HEDGED = /^\W*if\b|\bif (you|we|your|there|it)\b|\b(may|might) (receive|be (contacted|asked|invited)|not hear|hear)/i;

// Applicant tracking systems' mail, and automated senders in general.
const ATS_SENDER = new RegExp("greenhouse-mail\\.io|ashbyhq\\.com|workday\\.com|eightfold\\.ai|workablemail\\.com|icims\\.com"
  + "|smartrecruiters|successfactors|oraclecloud\\.com|jobvite|gem\\.com", "i");
const AUTOMATED_SENDER = new RegExp(ATS_SENDER.source + "|myworkdayjobs\\.com|no-?reply|do-?not-?reply|donotreply|notifications?@"
  + "|recruiting|careers|talent|hiring|campus|university|early-?careers|jobs@|apply@", "i");

// Words dropped from tracker company names before matching, so "The D. E. Shaw Group" matches "deshaw".
const COMPANY_FILLER = new RegExp("\\b(the|inc|incorporated|group|technologies|technology|industries|labs|systems|corporation"
  + "|company|co|llc|ltd|holdings)\\b", "gi");

export type Message = {
  id: string;
  sender: string;
  subject: string;
  body: string;
  received: number;  // seconds since the epoch
  labels: string[];
};

/** Return why `message` may be trashed ("receipt" or "code"), or null to keep it. */
export function classify(message: Message, companies: Iterable<RegExp>, now: number, graceMinutes: number): string | null {
  if (now - message.received < graceMinutes * 60) {
    return null;  // a running agent may still read it
  }
  if (message.labels.includes("STARRED") || /^\s*(re|fwd?):/i.test(message.subject)) {
    return null;
  }
  if (!AUTOMATED_SENDER.test(message.sender)) {
    return null;
  }

  const text = `${message.subject}\n${message.body}`;
  if (ACTION.test(text) || sentences(text).some((sentence) => !HEDGED.test(sentence) && DECISION.test(sentence))) {
    return null;
  }

  // Receipts name the company in the sender, the subject, or their opening lines.
  const named = `${message.sender} ${message.subject} ${message.body.slice(0, 500)}`.toLowerCase();
  if (![...companies].some((company) => company.test(named))) {
    return null;
  }

  if (CODE.test(message.subject) && (message.subject.toLowerCase().includes("application") || ATS_SENDER.test(message.sender))) {
    return "code";
  }
  if (RECEIPT.test(text) && JOB_CONTEXT.test(text)) {
    return "receipt";
  }
  return null;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/);
}

/** Return a pattern for each company in the tracker (see `companyPattern`). */
export async function trackerCompanies(sheetId: string): Promise<RegExp[]> {
  const patterns = new Set<string>();
  for (const name of await new Tracker(sheetId).companies()) {
    const pattern = companyPattern(name);
    if (pattern) {
      patterns.add(pattern);
    }
  }

  return [...patterns].map((pattern) => new RegExp(pattern));
}

/**
 * Return a regex that finds the company `name` as whole words in lowercase text, with or without the spaces
 * and dots between them: "The D. E. Shaw Group" finds "D. E. Shaw" and "deshaw.com", and "Point72" finds
 * "point72". null for names under three letters, which would match too much.
 */
export function companyPattern(name: string): string | null {
  const words = name.toLowerCase().replace(COMPANY_FILLER, " ").match(/[a-z0-9]+/g) ?? [];
  if (words.join("").replace(/[0-9]/g, "").length < 3) {
    return null;
  }
  return "\\b" + words.join("[\\W_]*") + "\\b";
}

type Trashed = { id: string; reason: string; from: string; subject: string };

/** Trash the confirmations of the last `days` days that are at least `graceMinutes` old; return what qualified. */
export async function cleanConfirmations(
  sheetId: string, { graceMinutes, days = 2, dryRun = false }: { graceMinutes: number; days?: number; dryRun?: boolean },
): Promise<Trashed[]> {
  const companies = await trackerCompanies(sheetId);
  const now = Date.now() / 1000;
  const trashed: Trashed[] = [];

  for (const message of await search(`newer_than:${days}d ${SEARCH}`)) {
    const reason = classify(message, companies, now, graceMinutes);
    if (reason === null) {
      continue;
    }

    if (!dryRun) {
      await gmail("POST", `/messages/${message.id}/trash`);
    }
    trashed.push({ id: message.id, reason, from: message.sender, subject: message.subject });
  }

  return trashed;
}

/** Collaborators that tests replace. */
export const io = { cleanConfirmations };

/**
 * Run `cleanConfirmations` unless another process is at it or one ran in the last `CLEAN_EVERY_MINUTES`.
 *
 * Returns what was trashed, or null when it did not run.
 */
export async function cleanNowAndThen(sheetId: string): Promise<Trashed[] | null> {
  const lock = tryLock(join(paths.state, "mail.lock"));
  if (lock === null) {
    return null;
  }

  try {
    const stamp = join(paths.state, "mail-cleaned");
    if (existsSync(stamp) && Date.now() - statSync(stamp).mtimeMs < CLEAN_EVERY_MINUTES * 60_000) {
      return null;
    }

    const trashed = await io.cleanConfirmations(sheetId, { graceMinutes: GRACE_MINUTES });
    writeFileSync(stamp, "");
    return trashed;
  } finally {
    lock.release();
  }
}

/**
 * Have launchd run `jobs clean-mail` every `everyMinutes` minutes, so mail is cleaned between apply runs too.
 *
 * Its output goes to `cleanupLog()`. `launchctl bootout gui/$UID/dev.jobs.clean-mail` and deleting
 * `SCHEDULE_PLIST` stop it. It runs the Node running this command, so after Node moves, schedule again.
 */
export function schedule(everyMinutes = 15): void {
  const log = cleanupLog();
  const job = {
    Label: SCHEDULE_LABEL,
    ProgramArguments: [process.execPath, "--disable-warning=ExperimentalWarning", join(REPO_ROOT, "src/cli.ts"), "clean-mail"],
    WorkingDirectory: REPO_ROOT,
    StartInterval: everyMinutes * 60,
    RunAtLoad: true,
    Umask: 0o077,  // the log holds subjects of Adam's mail
    StandardOutPath: log,
    StandardErrorPath: log,
  };

  // launchd reads property lists, which macOS's plutil writes from JSON.
  writeFileSync(SCHEDULE_PLIST, JSON.stringify(job));
  execFileSync("plutil", ["-convert", "xml1", SCHEDULE_PLIST]);

  const domain = `gui/${process.getuid!()}`;
  spawnSync("launchctl", ["bootout", `${domain}/${SCHEDULE_LABEL}`]);  // replace any old one
  execFileSync("launchctl", ["bootstrap", domain, SCHEDULE_PLIST]);
}

/** Have Adam grant the cleanup's Gmail scope in his browser and save its token; the account must be `email`. */
export async function authorize(email: string): Promise<void> {
  await google.authorize(TOKEN, [SCOPE], email);

  const granted = (await gmail("GET", "/profile")).emailAddress;
  if (granted.toLowerCase() !== email.toLowerCase()) {
    rmSync(TOKEN);
    throw new Error(`Access was granted for ${granted}, not ${email}; run it again and choose ${email}`);
  }
}

async function search(query: string): Promise<Message[]> {
  const ids: string[] = [];
  let page: string | undefined;

  do {
    const params = new URLSearchParams({ q: query, maxResults: "500", ...(page ? { pageToken: page } : {}) });
    const found = await gmail("GET", `/messages?${params}`);
    ids.push(...(found.messages ?? []).map((message: { id: string }) => message.id));
    page = found.nextPageToken;
  } while (page);

  const messages: Message[] = [];
  for (const id of ids) {
    messages.push(await message(id));
  }
  return messages;
}

async function message(id: string): Promise<Message> {
  const data = await gmail("GET", `/messages/${id}?format=full`);
  const headers = new Map<string, string>(
    (data.payload.headers ?? []).map((header: { name: string; value: string }) => [header.name.toLowerCase(), header.value]),
  );

  return {
    id,
    sender: headers.get("from") ?? "",
    subject: headers.get("subject") ?? "",
    body: text(data.payload),
    received: Number(data.internalDate) / 1000,
    labels: data.labelIds ?? [],
  };
}

type Part = { mimeType?: string; parts?: Part[]; body?: { data?: string } };

/** Return a message part's plain text, from HTML when it has no plain-text part. */
function text(part: Part): string {
  if (part.parts?.length) {
    const texts = part.parts.map(text);
    const plain = part.parts.findIndex((child, i) => child.mimeType === "text/plain" && texts[i]);
    return plain === -1 ? texts.join(" ") : texts[plain];
  }

  const data = part.body?.data;
  if (!data) {
    return "";
  }

  let content = Buffer.from(data, "base64url").toString("utf8");
  if (part.mimeType === "text/html") {
    content = unescapeHtml(content.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>|<[^>]+>/gi, " "));
  }
  return content.replace(/\s+/g, " ");
}

// The named entities that job mail uses; numeric ones are decoded too.
const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022",
  middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
};

function unescapeHtml(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/**
 * Call the Gmail API, waiting out its per-minute quota: it answers 429, or 403 naming the quota.
 *
 * Trashing a message twice is harmless, so writes are retried too.
 */
export function gmail(method: string, path: string): Promise<any> {
  const throttled = (error: HttpError) => error.status === 429 || (error.status === 403 && /quota|rate ?limit/i.test(error.body));
  return google.call(API + path, TOKEN, { method, retryable: throttled });
}
