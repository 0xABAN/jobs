import assert from "node:assert/strict";
import { test } from "node:test";
import type { TestContext } from "node:test";

import { HttpError } from "../../src/google/errors.ts";
import * as http from "../../src/google/http.ts";
import { Sheet } from "../../src/google/sheets.ts";
import { fakeFetch, replace } from "../helpers.ts";

function signedIn(t: TestContext, waits: number[] = []): void {
  replace(t, http.io, "accessToken", async () => "token");
  replace(t, http.io, "sleep", async (seconds) => void waits.push(seconds));
}

test("throttled calls are retried until Sheets answers", async (t) => {
  const waits: number[] = [];
  signedIn(t, waits);
  replace(t, globalThis, "fetch", fakeFetch([429, 503, { values: [["URL"], ["https://job"]] }]));

  assert.deepEqual(await new Sheet("id").rows("Apps"), [{ URL: "https://job" }]);
  assert.deepEqual(waits, [2, 4]);
});

test("other errors and a lasting throttle still throw", async (t) => {
  signedIn(t);
  let status = 0;
  replace(t, globalThis, "fetch", (async () => new Response("{}", { status })) as typeof fetch);

  for (status of [403, 429]) {
    await assert.rejects(new Sheet("id").rows("Apps"), HttpError);
  }
});

test("a failed write is not repeated", async (t) => {
  signedIn(t);
  const calls: { method: string; url: string }[] = [];
  replace(t, globalThis, "fetch", fakeFetch([503, 503], calls));

  await assert.rejects(new Sheet("id").call("POST", "/values/Apps:append", { values: [["x"]] }), HttpError);
  assert.deepEqual(calls.map((call) => call.method), ["POST"]);
});
