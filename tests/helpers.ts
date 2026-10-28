import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { paths } from "../src/shared/config.ts";

export function replace<T extends object, K extends keyof T>(t: TestContext, object: T, key: K, value: T[K]): void {
  const original = object[key];
  object[key] = value;
  t.after(() => {
    object[key] = original;
  });
}

export function tempDir(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "jobs-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

export function tempState(t: TestContext): string {
  const directory = tempDir(t);
  replace(t, paths, "state", directory);
  return directory;
}

type Reply = number | [status: number, body: string] | object;

export function fakeFetch(replies: Reply[], calls: { method: string; url: string }[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url) });

    const reply = replies.shift();
    if (typeof reply === "number") {
      return new Response("{}", { status: reply });
    }
    if (Array.isArray(reply)) {
      return new Response(reply[1], { status: reply[0] });
    }
    return Response.json(reply);
  }) as typeof fetch;
}
