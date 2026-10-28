import assert from "node:assert/strict";
import { test } from "node:test";

import { main } from "../../src/cli/main.ts";
import { replace } from "../helpers.ts";

test("a mistake on the command line prints the usage and exits with 2", async (t) => {
  const errors: string[] = [];
  replace(t, console, "error", (line: string) => void errors.push(line));

  assert.equal(await main(["apply", "--workers", "many", "https://job"]), 2);
  assert.equal(await main(["unknown"]), 2);

  assert.match(errors[0], /--workers takes a number/);
  assert.match(errors[1], /unknown command: unknown/);
});
