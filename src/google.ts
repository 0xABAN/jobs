/**
 * Google OAuth and API calls for the harness's own API clients (Sheets, and Gmail cleanup).
 *
 * Both use the Desktop OAuth client in `.mcp/gmail-oauth.json`, each with its own refresh token,
 * so each holds only the scopes it needs.
 */

import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { REPO_ROOT } from "./config.ts";

export const CLIENT = join(REPO_ROOT, ".mcp/gmail-oauth.json");
export const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Google's per-user quotas reset each minute. Throttled calls were not carried out, so they are
// retried after these waits, which span more than a minute.
export const RETRY_WAITS = [2, 4, 8, 16, 32];

const TIMEOUT_MS = 30_000;

/** A Google API's error reply. */
export class HttpError extends Error {
  status: number;
  body: string;
  retryAfter: string | null;

  constructor(url: string, status: number, body: string, retryAfter: string | null = null) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

/** Collaborators that tests replace. */
export const io = {
  sleep: (seconds: number) => sleep(seconds * 1000),
  accessToken,
};

// Access tokens by refresh-token file: each is valid for an hour.
const tokens = new Map<string, { value: string; expires: number }>();

/** The Desktop OAuth client's ID and secret. */
export function client(): { client_id: string; client_secret: string } {
  return JSON.parse(readFileSync(CLIENT, "utf8")).installed;
}

/** Send `fields` to Google's token endpoint along with the OAuth client's credentials, and return its reply. */
export async function tokenRequest(fields: Record<string, string>): Promise<Record<string, any>> {
  const { client_id, client_secret } = client();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({ client_id, client_secret, ...fields }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new HttpError(TOKEN_URL, response.status, await response.text());
  }
  return response.json();
}

/** Return an access token for the refresh token in `tokenPath`, exchanging it again only when it is about to expire. */
export async function accessToken(tokenPath: string): Promise<string> {
  const cached = tokens.get(tokenPath);
  if (cached && performance.now() < cached.expires) {
    return cached.value;
  }

  const refreshToken = JSON.parse(readFileSync(tokenPath, "utf8")).refresh_token;
  const reply = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

  const lifetimeSeconds = (reply.expires_in ?? 3600) - 300;
  tokens.set(tokenPath, { value: reply.access_token, expires: performance.now() + lifetimeSeconds * 1000 });
  return reply.access_token;
}

type CallOptions = {
  method?: string;
  body?: unknown;
  /** Whether an error reply may be retried: the call was not carried out, as when throttled. */
  retryable: (error: HttpError) => boolean;
};

/**
 * Call a Google API with the refresh token in `tokenPath` and return its JSON reply.
 *
 * An error that `retryable` accepts is retried after each of `RETRY_WAITS` in turn, or after
 * the reply's `Retry-After`. Any other error, and the last one, is thrown.
 */
export async function call(url: string, tokenPath: string, { method = "GET", body, retryable }: CallOptions): Promise<any> {
  const json: Record<string, string> = body === undefined ? {} : { "Content-Type": "application/json" };

  for (const wait of [...RETRY_WAITS, null]) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${await io.accessToken(tokenPath)}`, ...json },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.ok) {
      return response.json();
    }

    const error = new HttpError(url, response.status, await response.text(), response.headers.get("retry-after"));
    if (!retryable(error) || wait === null) {
      throw error;
    }

    const retryAfter = Number.parseInt(error.retryAfter ?? "", 10);
    await io.sleep(Number.isNaN(retryAfter) ? wait : retryAfter);
  }
}

/**
 * Return whether `error` is a network failure rather than a reply: offline, DNS, refused, dropped, or timed out.
 */
export function isNetworkError(error: unknown): boolean {
  // fetch() reports a failed connection as "fetch failed", and one that drops mid-reply as "terminated".
  return (error instanceof TypeError && ["fetch failed", "terminated"].includes(error.message))
    || (error instanceof DOMException && error.name === "TimeoutError");
}

/**
 * Have Adam grant `scopes` in his browser, and save the refresh token to `tokenPath`.
 *
 * Uses the Desktop client's loopback flow with PKCE. `loginHint` preselects his account; he can
 * still choose another, so callers that care check which account granted access.
 */
export async function authorize(tokenPath: string, scopes: string[], loginHint: string): Promise<void> {
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  // Google redirects the browser to this one-shot server with the authorization code.
  let resolveReply: (reply: URLSearchParams) => void;
  const replied = new Promise<URLSearchParams>((resolve) => (resolveReply = resolve));
  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Access is granted. You can close this tab.");
    resolveReply(new URL(request.url ?? "/", "http://127.0.0.1").searchParams);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: client().client_id, redirect_uri: redirect, response_type: "code", scope: scopes.join(" "),
    access_type: "offline", prompt: "consent", login_hint: loginHint, state,
    code_challenge: challenge, code_challenge_method: "S256",
  });
  console.log(`Opening Google's consent page; if no browser opens, visit:\n${url}`);
  execFile("open", [url], () => {});  // the printed URL covers a browser that does not open

  const reply = await replied;
  server.close();
  if (reply.get("state") !== state || !reply.has("code")) {
    throw new Error(`Google did not grant access: ${reply.get("error") ?? reply}`);
  }

  const grant = await tokenRequest({
    code: reply.get("code")!, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect,
  });
  const granted = String(grant.scope ?? "").split(" ");
  const missing = scopes.filter((scope) => !granted.includes(scope));
  if (missing.length) {
    throw new Error(`Google granted ${JSON.stringify(grant.scope)}, without ${missing.join(", ")}`);
  }

  writeFileSync(tokenPath, JSON.stringify({ refresh_token: grant.refresh_token, scope: grant.scope }), { mode: 0o600 });
}
