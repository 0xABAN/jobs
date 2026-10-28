import assert from "node:assert/strict";
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import * as cleanup from "../../src/mail/cleanup.ts";
import { replace, tempState } from "../helpers.ts";

test("apply cleans at most every ten minutes", async (t) => {
  const state = tempState(t);
  const graces: number[] = [];
  replace(t, cleanup.io, "cleanConfirmations", async (_sheetId, { graceMinutes }) => {
    graces.push(graceMinutes);
    return [{ id: "m", reason: "receipt", from: "", subject: "" }];
  });

  assert.equal((await cleanup.cleanNowAndThen("sheet"))?.length, 1);
  assert.equal(await cleanup.cleanNowAndThen("sheet"), null);

  const elevenMinutesAgo = new Date(Date.now() - 11 * 60_000);
  utimesSync(join(state, "mail-cleaned"), elevenMinutesAgo, elevenMinutesAgo);
  assert.equal((await cleanup.cleanNowAndThen("sheet"))?.length, 1);
  assert.deepEqual(graces, [cleanup.GRACE_MINUTES, cleanup.GRACE_MINUTES]);
});
