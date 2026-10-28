import assert from "node:assert/strict";
import { test } from "node:test";

import * as cli from "../src/cli.ts";
import type { Profile } from "../src/config.ts";
import { replace } from "./helpers.ts";

test("clean-mail reports a network failure in one line", async (t) => {
  const errors: string[] = [];
  replace(t, cli.io, "cleanConfirmations", async () => {
    throw new TypeError("fetch failed");
  });
  replace(t, cli.io, "loadProfile", () => ({ tracker: { sheet_id: "sheet" } }) as Profile);
  replace(t, console, "error", (line: string) => void errors.push(line));

  assert.equal(await cli.main(["clean-mail"]), 1);

  assert.equal(errors.length, 1);
  assert.equal(JSON.parse(errors[0]).mail_cleanup, "error");
});

test("a mistake on the command line prints the usage and exits with 2", async (t) => {
  const errors: string[] = [];
  replace(t, console, "error", (line: string) => void errors.push(line));

  assert.equal(await cli.main(["apply", "--workers", "many", "https://job"]), 2);
  assert.match(errors[0], /--workers takes a number/);
});
