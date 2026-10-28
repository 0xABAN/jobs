/** Local dates and times, as the tracker, run ids, and the prompt write them. */

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 2026-10-28 */
export function isoDate(time = new Date()): string {
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

/** 2026-10-28 13:05 */
export function minute(time = new Date()): string {
  return `${isoDate(time)} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/** 20261028-130512, the start of a run id. */
export function stamp(time = new Date()): string {
  return isoDate(time).replaceAll("-", "") + `-${pad(time.getHours())}${pad(time.getMinutes())}${pad(time.getSeconds())}`;
}

/** 10/28/2026, as US forms want it. */
export function usDate(time = new Date()): string {
  return `${pad(time.getMonth() + 1)}/${pad(time.getDate())}/${time.getFullYear()}`;
}
