import { setTimeout as sleep } from "node:timers/promises";

const POLL_MS = 250;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      return false;
    }
    throw error;
  }
}

export function killProcessGroup(group: number): void {
  try {
    process.kill(-group, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

export async function waitFor<T>(condition: () => T, seconds: number): Promise<T | null> {
  const deadline = performance.now() + seconds * 1000;

  let value: T;
  while (!(value = condition())) {
    if (performance.now() > deadline) {
      return null;
    }
    await sleep(POLL_MS);
  }
  return value;
}
