import { setTimeout as sleep } from "node:timers/promises";

import { HttpError } from "./errors.ts";
import { accessToken } from "./oauth.ts";

export const RETRY_WAITS_SECONDS = [2, 4, 8, 16, 32];
const TIMEOUT_MS = 30_000;

export const io = {
  sleep: (seconds: number) => sleep(seconds * 1000),
  accessToken,
};

type CallOptions = {
  method?: string;
  body?: unknown;
  retryable: (error: HttpError) => boolean;
};

export async function call(url: string, tokenPath: string, { method = "GET", body, retryable }: CallOptions): Promise<any> {
  for (const wait of [...RETRY_WAITS_SECONDS, null]) {
    const response = await fetch(url, {
      method,
      headers: await headers(tokenPath, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) {
      return response.json();
    }

    const error = new HttpError(url, response.status, await response.text(), response.headers.get("retry-after"));
    if (wait === null || !retryable(error)) {
      throw error;
    }
    await io.sleep(retryAfterSeconds(error) ?? wait);
  }
}

async function headers(tokenPath: string, json: boolean): Promise<Record<string, string>> {
  const authorization = { Authorization: `Bearer ${await io.accessToken(tokenPath)}` };
  return json ? { ...authorization, "Content-Type": "application/json" } : authorization;
}

function retryAfterSeconds(error: HttpError): number | null {
  const seconds = Number.parseInt(error.retryAfter ?? "", 10);
  return Number.isNaN(seconds) ? null : seconds;
}
