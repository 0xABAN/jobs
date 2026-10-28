import { existsSync, statSync, writeFileSync } from "node:fs";

import { searchMessages, trashMessage } from "../google/gmail.ts";
import { statePath } from "../shared/config.ts";
import { tryLock } from "../shared/lock.ts";
import { Tracker } from "../tracker/tracker.ts";
import { classify, companyPattern } from "./classify.ts";
import type { Disposal } from "./classify.ts";

export const GRACE_MINUTES = 15;
export const CLEAN_EVERY_MINUTES = 10;

const CANDIDATES = '-in:trash -is:starred (subject:(application OR applying OR applied OR resume OR "security code" OR verify '
  + 'OR verification OR "candidate account" OR "thank you" OR thanks OR received OR submitted OR interest))';

export type Trashed = { id: string; reason: Disposal; from: string; subject: string };

type CleanOptions = { graceMinutes: number; days?: number; dryRun?: boolean };

export const io = { cleanConfirmations };

export async function cleanConfirmations(sheetId: string, { graceMinutes, days = 2, dryRun = false }: CleanOptions): Promise<Trashed[]> {
  const companies = await trackerCompanies(sheetId);
  const now = Date.now() / 1000;
  const trashed: Trashed[] = [];

  for (const message of await searchMessages(`newer_than:${days}d ${CANDIDATES}`)) {
    const reason = classify(message, companies, now, graceMinutes);
    if (reason === null) {
      continue;
    }

    if (!dryRun) {
      await trashMessage(message.id);
    }
    trashed.push({ id: message.id, reason, from: message.sender, subject: message.subject });
  }

  return trashed;
}

export async function cleanNowAndThen(sheetId: string): Promise<Trashed[] | null> {
  const lock = tryLock(statePath("mail.lock"));
  if (lock === null) {
    return null;
  }

  try {
    const stamp = statePath("mail-cleaned");
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

async function trackerCompanies(sheetId: string): Promise<RegExp[]> {
  const patterns = new Set<string>();
  for (const name of await new Tracker(sheetId).companies()) {
    const pattern = companyPattern(name);
    if (pattern) {
      patterns.add(pattern);
    }
  }
  return [...patterns].map((pattern) => new RegExp(pattern));
}
