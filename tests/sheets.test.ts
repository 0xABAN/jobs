import assert from "node:assert/strict";
import { test } from "node:test";

import * as google from "../src/google.ts";
import { HttpError } from "../src/google.ts";
import { Sheet } from "../src/sheets.ts";
import { fakeFetch, replace } from "./helpers.ts";

test("throttled calls are retried until Sheets answers", async (t) => {
  const waits: number[] = [];
  replace(t, globalThis, "fetch", fakeFetch([429, 503, { values: [["URL"], ["https://job"]] }]) as typeof fetch);
  replace(t, google.io, "accessToken", async () => "token");
  replace(t, google.io, "sleep", async (seconds) => void waits.push(seconds));

  assert.deepEqual(await new Sheet("id").rows("Apps"), [{ URL: "https://job" }]);
  assert.deepEqual(waits, [2, 4]);
});

test("other errors and a lasting throttle still throw", async (t) => {
  let code = 0;
  replace(t, globalThis, "fetch", (async () => new Response("{}", { status: code })) as typeof fetch);
  replace(t, google.io, "accessToken", async () => "token");
  replace(t, google.io, "sleep", async () => {});

  for (code of [403, 429]) {
    await assert.rejects(new Sheet("id").rows("Apps"), HttpError);
  }
});

test("a failed write is not repeated", async (t) => {
  const calls: { method: string; url: string }[] = [];
  replace(t, globalThis, "fetch", fakeFetch([503, 503], calls) as typeof fetch);
  replace(t, google.io, "accessToken", async () => "token");
  replace(t, google.io, "sleep", async () => {});

  await assert.rejects(new Sheet("id").call("POST", "/values/Apps:append", { values: [["x"]] }), HttpError);
  assert.deepEqual(calls.map((call) => call.method), ["POST"]);
});
