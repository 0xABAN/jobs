import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

import { REPO_ROOT } from "../shared/config.ts";
import { HttpError } from "./errors.ts";

const CLIENT = join(REPO_ROOT, ".mcp/gmail-oauth.json");
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CONSENT_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TIMEOUT_MS = 30_000;
const EXPIRY_MARGIN_SECONDS = 300;

const accessTokens = new Map<string, { value: string; expires: number }>();

type OAuthClient = { client_id: string; client_secret: string };

export function client(): OAuthClient {
  return JSON.parse(readFileSync(CLIENT, "utf8")).installed;
}

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

export async function accessToken(tokenPath: string): Promise<string> {
  const cached = accessTokens.get(tokenPath);
  if (cached && performance.now() < cached.expires) {
    return cached.value;
  }

  const refreshToken = JSON.parse(readFileSync(tokenPath, "utf8")).refresh_token;
  const reply = await tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

  const lifetimeSeconds = (reply.expires_in ?? 3600) - EXPIRY_MARGIN_SECONDS;
  accessTokens.set(tokenPath, { value: reply.access_token, expires: performance.now() + lifetimeSeconds * 1000 });
  return reply.access_token;
}

export async function authorize(tokenPath: string, scopes: string[], loginHint: string): Promise<void> {
  const verifier = randomBytes(64).toString("base64url");
  const state = randomBytes(16).toString("base64url");
  const redirect = await listenForRedirect();

  const consent = `${CONSENT_URL}?${new URLSearchParams({
    client_id: client().client_id,
    redirect_uri: redirect.uri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline",
    prompt: "consent",
    login_hint: loginHint,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  })}`;
  console.log(`Opening Google's consent page; if no browser opens, visit:\n${consent}`);
  execFile("open", [consent], () => {});

  const reply = await redirect.reply;
  if (reply.get("state") !== state || !reply.has("code")) {
    throw new Error(`Google did not grant access: ${reply.get("error") ?? reply}`);
  }

  const grant = await tokenRequest({
    code: reply.get("code")!,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirect.uri,
  });
  assertGranted(String(grant.scope ?? ""), scopes);

  writeFileSync(tokenPath, JSON.stringify({ refresh_token: grant.refresh_token, scope: grant.scope }), { mode: 0o600 });
}

async function listenForRedirect(): Promise<{ uri: string; reply: Promise<URLSearchParams> }> {
  let resolveReply!: (reply: URLSearchParams) => void;
  const reply = new Promise<URLSearchParams>((resolve) => (resolveReply = resolve));

  const server = createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Access is granted. You can close this tab.");
    server.close();
    resolveReply(new URL(request.url ?? "/", "http://127.0.0.1").searchParams);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return { uri: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, reply };
}

function assertGranted(granted: string, scopes: string[]): void {
  const missing = scopes.filter((scope) => !granted.split(" ").includes(scope));
  if (missing.length) {
    throw new Error(`Google granted ${JSON.stringify(granted)}, without ${missing.join(", ")}`);
  }
}
