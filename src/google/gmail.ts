import { rmSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../shared/config.ts";
import type { HttpError } from "./errors.ts";
import { call } from "./http.ts";
import { bodyText } from "./mime.ts";
import type { MessagePart } from "./mime.ts";
import { authorize } from "./oauth.ts";

export const TOKEN = join(REPO_ROOT, ".mcp/gmail-cleanup-token.json");
export const SCOPE = "https://www.googleapis.com/auth/gmail.modify";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const PAGE_SIZE = "500";
const THROTTLED = 429;
const FORBIDDEN = 403;
const QUOTA_MESSAGE = /quota|rate ?limit/i;

export type Message = {
  id: string;
  sender: string;
  subject: string;
  body: string;
  received: number;
  labels: string[];
};

export function gmail(method: string, path: string): Promise<any> {
  const throttled = (error: HttpError) =>
    error.status === THROTTLED || (error.status === FORBIDDEN && QUOTA_MESSAGE.test(error.body));
  return call(API + path, TOKEN, { method, retryable: throttled });
}

export async function searchMessages(query: string): Promise<Message[]> {
  const ids: string[] = [];
  let page: string | undefined;

  do {
    const params = new URLSearchParams({ q: query, maxResults: PAGE_SIZE, ...(page ? { pageToken: page } : {}) });
    const found = await gmail("GET", `/messages?${params}`);
    ids.push(...(found.messages ?? []).map((message: { id: string }) => message.id));
    page = found.nextPageToken;
  } while (page);

  const messages: Message[] = [];
  for (const id of ids) {
    messages.push(await readMessage(id));
  }
  return messages;
}

export async function readMessage(id: string): Promise<Message> {
  const data = await gmail("GET", `/messages/${id}?format=full`);
  const headers = new Map<string, string>(
    (data.payload.headers ?? []).map((header: { name: string; value: string }) => [header.name.toLowerCase(), header.value]),
  );

  return {
    id,
    sender: headers.get("from") ?? "",
    subject: headers.get("subject") ?? "",
    body: bodyText(data.payload as MessagePart),
    received: Number(data.internalDate) / 1000,
    labels: data.labelIds ?? [],
  };
}

export async function trashMessage(id: string): Promise<void> {
  await gmail("POST", `/messages/${id}/trash`);
}

export async function authorizeCleanup(email: string): Promise<void> {
  await authorize(TOKEN, [SCOPE], email);

  const granted = (await gmail("GET", "/profile")).emailAddress;
  if (granted.toLowerCase() !== email.toLowerCase()) {
    rmSync(TOKEN);
    throw new Error(`Access was granted for ${granted}, not ${email}; run it again and choose ${email}`);
  }
}
