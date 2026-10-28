import assert from "node:assert/strict";
import { test } from "node:test";

import * as mail from "../../src/cli/mail.ts";
import type { Profile } from "../../src/shared/config.ts";
import { replace } from "../helpers.ts";

test("clean-mail reports a network failure in one line", async (t) => {
  const errors: string[] = [];
  replace(t, mail.io, "cleanConfirmations", async () => {
    throw new TypeError("fetch failed");
  });
  replace(t, mail.io, "loadProfile", () => ({ tracker: { sheet_id: "sheet" } }) as Profile);
  replace(t, console, "error", (line: string) => void errors.push(line));

  assert.equal(await mail.cleanMailCommand([]), 1);

  assert.equal(errors.length, 1);
  assert.equal(JSON.parse(errors[0]).mail_cleanup, "error");
});
