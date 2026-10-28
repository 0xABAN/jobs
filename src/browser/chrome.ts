import { execFile } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { isAlive, waitFor } from "../shared/process.ts";
import { cdp } from "./cdp.ts";

const START_TIMEOUT_SECONDS = 30;
const QUIT_TIMEOUT_SECONDS = 10;
const HTTP_CACHE_BYTES = 64 * 1024 * 1024;

const FLAGS = [
  "--remote-debugging-port=0",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  `--disk-cache-size=${HTTP_CACHE_BYTES}`,
];

const REBUILDABLE_CACHES = ["Default/Cache", "Default/Code Cache", "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "component_crx_cache"];

export const io = { launch, close, isAlive };

export async function withChrome<T>(profile: string, url: string, body: (pid: number) => Promise<T>): Promise<T> {
  const pid = await io.launch(profile, url);
  try {
    return await body(pid);
  } finally {
    await io.close(pid);
    if (!io.isAlive(pid)) {
      await dropCaches(profile);
    }
  }
}

export async function launch(profile: string, url: string): Promise<number> {
  const owner = profileOwner(profile);
  if (owner) {
    throw new Error(`Chrome (pid ${owner}) is already using ${profile}; quit it first`);
  }

  rmSync(devtoolsFile(profile), { force: true });
  await promisify(execFile)("open", ["-g", "-n", "-a", "Google Chrome", "--args", `--user-data-dir=${profile}`,
    "--no-startup-window", ...FLAGS]);

  const pid = await waitFor(() => existsSync(devtoolsFile(profile)) && profileOwner(profile), START_TIMEOUT_SECONDS);
  if (!pid) {
    throw new Error(`Chrome did not start on ${profile}`);
  }

  try {
    await openBackgroundWindow(profile, url);
  } catch (error) {
    await close(pid);
    throw error;
  }
  return pid;
}

export async function close(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");
  await waitFor(() => !isAlive(pid), QUIT_TIMEOUT_SECONDS);
}

export function devtoolsPort(profile: string): number {
  return Number(devtoolsEndpoint(profile).port);
}

function devtoolsFile(profile: string): string {
  return join(profile, "DevToolsActivePort");
}

function devtoolsEndpoint(profile: string): { port: string; path: string } {
  const [port, path] = readFileSync(devtoolsFile(profile), "utf8").split(/\s+/);
  return { port, path };
}

async function openBackgroundWindow(profile: string, url: string): Promise<void> {
  const { port, path } = devtoolsEndpoint(profile);
  const reply = await cdp(`ws://127.0.0.1:${port}${path}`, "Target.createTarget", { url, newWindow: true, background: true });
  if (reply.error) {
    throw new Error(`Chrome could not open ${url}: ${reply.error.message}`);
  }
}

function profileOwner(profile: string): number | null {
  let lockTarget: string;
  try {
    lockTarget = readlinkSync(join(profile, "SingletonLock"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const pid = Number(lockTarget.slice(lockTarget.lastIndexOf("-") + 1));
  return isAlive(pid) ? pid : null;
}

async function dropCaches(profile: string): Promise<void> {
  await Promise.all(REBUILDABLE_CACHES.map((cache) => rm(join(profile, cache), { recursive: true, force: true })));
}
