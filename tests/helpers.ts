/** Test helpers: temporary directories and replacing a collaborator for one test. */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import { paths } from "../src/config.ts";

/** Set `object[key]` to `value` until the test ends. */
export function replace<T extends object, K extends keyof T>(t: TestContext, object: T, key: K, value: T[K]): void {
  const original = object[key];
  object[key] = value;
  t.after(() => {
    object[key] = original;
  });
}

/** Return a temporary directory that is deleted when the test ends. */
export function tempDir(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "jobs-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Point the harness's state directory (workers, runs, locks) at a temporary one for the test. */
export function tempState(t: TestContext): string {
  const directory = tempDir(t);
  replace(t, paths, "state", directory);
  return directory;
}

/** A fetch() that answers with `replies` in turn: a status code alone, or a JSON body to send with 200. */
export function fakeFetch(replies: (number | [number, string] | object)[], calls: { method: string; url: string }[] = []) {
  return async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ method: init?.method ?? "GET", url: String(url) });

    const reply = replies.shift();
    if (typeof reply === "number") {
      return new Response("{}", { status: reply });
    }
    if (Array.isArray(reply)) {
      return new Response(reply[1], { status: reply[0] });
    }
    return Response.json(reply);
  };
}
