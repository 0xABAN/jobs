/**
 * Run the harness's background Chrome: each apply agent's, and the `jobs` profile for `jobs browse`.
 *
 * The harness launches Chrome itself, as ApplyPilot does, so it chooses the
 * flags: CUA's own launch leaves Chrome throttling hidden windows. An apply
 * agent's Playwright attaches over the DevTools port, and CUA attaches to a
 * `jobs browse` Chrome by its pid, which its `--grant existing-profile` allows.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const FLAGS = [
  "--remote-debugging-port=0",  // any free port, which Chrome writes to DevToolsActivePort
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  // Chrome slows pages in covered or background windows; the agent works in one.
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  // Many workers share a nearly full disk; cap each run's HTTP cache (64 MB) while it runs.
  "--disk-cache-size=67108864",
];

// Caches Chrome rebuilds on demand. They grow each worker's profile by ~300 MB, and 20 workers
// share a nearly full disk, so they are deleted after every run. Logins live in cookies and site
// storage, which stay.
const CACHES = ["Default/Cache", "Default/Code Cache", "Default/Service Worker/CacheStorage",
  "Default/Service Worker/ScriptCache", "GrShaderCache", "GraphiteDawnCache", "ShaderCache", "component_crx_cache"];

/** Collaborators that tests replace. */
export const io = { launch, close, alive };

/** Open `url` in a background Chrome on `profile`, run `body` with its pid, and quit it afterwards, dropping its caches. */
export async function withChrome<T>(profile: string, url: string, body: (pid: number) => Promise<T>): Promise<T> {
  const pid = await io.launch(profile, url);
  try {
    return await body(pid);
  } finally {
    await io.close(pid);
    if (!io.alive(pid)) {  // never delete files under a Chrome that is still running
      await Promise.all(CACHES.map((cache) => rm(join(profile, cache), { recursive: true, force: true })));
    }
  }
}

/**
 * Open `url` in a background Chrome on `profile` and return its pid.
 *
 * Throws when another Chrome already uses the profile or this one does not start.
 */
export async function launch(profile: string, url: string): Promise<number> {
  const owner = profileOwner(profile);
  if (owner) {
    throw new Error(`Chrome (pid ${owner}) is already using ${profile}; quit it first`);
  }

  // Chrome writes this file once its debugger listens; a stale copy would fake readiness.
  rmSync(join(profile, "DevToolsActivePort"), { force: true });

  // Chrome takes focus from Adam's app when it opens its startup window, even when `open -g`
  // launches it in the background. So it starts windowless, and the job opens in a background
  // window, which leaves focus alone. `-n` starts an instance apart from personal Chrome.
  await promisify(execFile)("open", ["-g", "-n", "-a", "Google Chrome", "--args", `--user-data-dir=${profile}`,
    "--no-startup-window", ...FLAGS]);

  const pid = await waitFor(() => existsSync(join(profile, "DevToolsActivePort")) && profileOwner(profile), 30);
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

/** Return the DevTools port of the Chrome running on `profile`; Chrome picked it at launch. */
export function devtoolsPort(profile: string): number {
  return Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\s+/)[0]);
}

/** Send one DevTools Protocol command over the WebSocket `endpoint` and return Chrome's reply. */
export async function cdp(endpoint: string, method: string, params: object): Promise<any> {
  const socket = new WebSocket(endpoint);

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Chrome did not answer ${method} within 30 seconds`)), 30_000);
      socket.addEventListener("open", () => socket.send(JSON.stringify({ id: 1, method, params })));
      socket.addEventListener("message", (event) => {
        const reply = JSON.parse(String(event.data));
        if (reply.id === 1) {  // anything else is an event, not our reply
          clearTimeout(timeout);
          resolve(reply);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Could not reach Chrome's DevTools at ${endpoint}`));
      });
    });
  } finally {
    socket.close();
  }
}

/** Quit the Chrome with `pid`, waiting up to 10 seconds for it to exit. */
export async function close(pid: number): Promise<void> {
  process.kill(pid, "SIGTERM");  // Chrome shuts down cleanly on SIGTERM
  await waitFor(() => !alive(pid), 10);
}

/** Return the pid of the Chrome using `profile`, read from its `SingletonLock` symlink ("<host>-<pid>"). */
function profileOwner(profile: string): number | null {
  let target: string;
  try {
    target = readlinkSync(join(profile, "SingletonLock"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }

  const pid = Number(target.slice(target.lastIndexOf("-") + 1));
  return alive(pid) ? pid : null;
}

/**
 * Open `url` in a new window of the Chrome on `profile` without activating Chrome.
 *
 * Uses the browser's DevTools endpoint, which Chrome names in `DevToolsActivePort`'s second line.
 */
async function openBackgroundWindow(profile: string, url: string): Promise<void> {
  const [port, path] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split(/\s+/);
  const reply = await cdp(`ws://127.0.0.1:${port}${path}`, "Target.createTarget", { url, newWindow: true, background: true });

  if (reply.error) {
    throw new Error(`Chrome could not open ${url}: ${reply.error.message}`);
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
  return true;
}

/** Poll `condition` until it returns a true value or `seconds` pass; return that value, or null. */
async function waitFor<T>(condition: () => T, seconds: number): Promise<T | null> {
  const deadline = performance.now() + seconds * 1000;

  let value: T;
  while (!(value = condition())) {
    if (performance.now() > deadline) {
      return null;
    }
    await sleep(250);
  }
  return value;
}
