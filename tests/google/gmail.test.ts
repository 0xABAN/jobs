import assert from "node:assert/strict";
import { test } from "node:test";

import { HttpError } from "../../src/google/errors.ts";
import { gmail } from "../../src/google/gmail.ts";
import * as http from "../../src/google/http.ts";
import { fakeFetch, replace } from "../helpers.ts";

test("Gmail calls wait out the per-minute quota", async (t) => {
  const waits: number[] = [];
  const quotaExceeded: [number, string] = [403, '{"error": {"message": "Quota exceeded for quota metric"}}'];
  const replies = [quotaExceeded, 429, { id: "m1" }];
  replace(t, globalThis, "fetch", fakeFetch(replies));
  replace(t, http.io, "accessToken", async () => "token");
  replace(t, http.io, "sleep", async (seconds) => void waits.push(seconds));

  assert.deepEqual(await gmail("GET", "/messages/m1"), { id: "m1" });
  assert.deepEqual(waits, [2, 4]);

  replies.push([403, '{"error": {"message": "Insufficient Permission"}}']);
  await assert.rejects(gmail("POST", "/messages/m1/trash"), HttpError);
});
