import { BANNED_SITES } from "./config.ts";

const BOARD_HOSTS = ["greenhouse.io", "ashbyhq.com"];

export function parseUrl(url: string): URL | null {
  return URL.canParse(url) ? new URL(url) : null;
}

export function hostname(url: string): string {
  return parseUrl(url)?.hostname ?? "";
}

export function onSite(url: string, sites: Iterable<string>): boolean {
  const host = hostname(url);
  return [...sites].some((site) => host === site || host.endsWith("." + site));
}

export function banned(url: string): boolean {
  return onSite(url, BANNED_SITES);
}

export function atsBoard(url: string): [ats: string, board: string] | null {
  const parts = parseUrl(url);
  const ats = BOARD_HOSTS.find((host) => onSite(url, [host]));
  if (!parts || !ats) {
    return null;
  }

  const firstSegment = parts.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
  const board = (parts.searchParams.get("for") || firstSegment).toLowerCase();
  return [ats, board === "embed" ? "" : board];
}
