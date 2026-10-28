import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "../shared/config.ts";

const PLAYWRIGHT_MCP = "@playwright/mcp@0.0.83";
const REPO_MCP_CONFIG = join(REPO_ROOT, ".pi/mcp.json");

export function connectPlaywright(directory: string, devtoolsPort: number, repoConfig = REPO_MCP_CONFIG): void {
  const config = JSON.parse(readFileSync(repoConfig, "utf8"));
  config.mcpServers = { gmail: config.mcpServers.gmail, playwright: playwrightServer(devtoolsPort) };

  const path = join(directory, ".pi/mcp.json");
  mkdirSync(join(directory, ".pi"), { recursive: true });
  rmSync(path, { force: true });
  writeFileSync(path, JSON.stringify(config, null, 2));
}

function playwrightServer(devtoolsPort: number): object {
  return {
    command: "npx",
    args: ["-y", "--prefer-offline", PLAYWRIGHT_MCP, "--cdp-endpoint", `http://127.0.0.1:${devtoolsPort}`, "--snapshot-mode", "none"],
    exposure: "codemode",
    description: "Drive the job page in Adam's background jobs Chrome",
  };
}
