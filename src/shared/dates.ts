function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function isoDate(time = new Date()): string {
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())}`;
}

export function isoMinute(time = new Date()): string {
  return `${isoDate(time)} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

export function runStamp(time = new Date()): string {
  const clock = `${pad(time.getHours())}${pad(time.getMinutes())}${pad(time.getSeconds())}`;
  return `${isoDate(time).replaceAll("-", "")}-${clock}`;
}

export function usDate(time = new Date()): string {
  return `${pad(time.getMonth() + 1)}/${pad(time.getDate())}/${time.getFullYear()}`;
}
