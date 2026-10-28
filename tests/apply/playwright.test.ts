import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { connectPlaywright } from "../../src/apply/playwright.ts";
import { tempDir } from "../helpers.ts";

test("connects Playwright to this run's Chrome in place of the repo's other servers", (t) => {
  const root = tempDir(t);
  const repoConfig = join(root, "repo/.pi/mcp.json");
  const worker = join(root, "worker");
  mkdirSync(join(root, "repo/.pi"), { recursive: true });
  writeFileSync(repoConfig, JSON.stringify({ mcpServers: { gmail: { command: "gmail" }, "google-sheets": { command: "sheets" } } }));
  mkdirSync(join(worker, ".pi"), { recursive: true });
  symlinkSync(repoConfig, join(worker, ".pi/mcp.json"));

  connectPlaywright(worker, 9333, repoConfig);

  const servers = JSON.parse(readFileSync(join(worker, ".pi/mcp.json"), "utf8")).mcpServers;
  assert.deepEqual(Object.keys(servers), ["gmail", "playwright"]);
  assert.ok(servers.playwright.args.includes("http://127.0.0.1:9333"));
  assert.ok("google-sheets" in JSON.parse(readFileSync(repoConfig, "utf8")).mcpServers);
});
