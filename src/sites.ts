/** What a job URL says about its application site. */

import { BANNED_SITES } from "./config.ts";

// Applicant tracking systems that serve many employers' boards from one host, told apart by path.
export const BOARD_HOSTS = ["greenhouse.io", "ashbyhq.com"] as const;

/** Parse `url`, or return null when it is not a URL, such as an empty tracker cell. */
export function parseUrl(url: string): URL | null {
  return URL.canParse(url) ? new URL(url) : null;
}

/** Return whether `url` is on one of `sites` or their subdomains. */
export function onSite(url: string, sites: Iterable<string>): boolean {
  const host = parseUrl(url)?.hostname ?? "";

  for (const site of sites) {
    if (host === site || host.endsWith("." + site)) {
      return true;
    }
  }

  return false;
}

/** Return whether `url` is on one of the `BANNED_SITES`. */
export function banned(url: string): boolean {
  return onSite(url, BANNED_SITES);
}

/**
 * Return the `BOARD_HOSTS` entry that `url` applies through and the employer's board there.
 *
 * The board is "" when the URL hides it, as an embed with only a token does. null when the
 * URL is on none of the `BOARD_HOSTS`.
 */
export function atsBoard(url: string): [ats: string, board: string] | null {
  const parts = parseUrl(url);
  if (!parts) {
    return null;
  }

  for (const ats of BOARD_HOSTS) {
    if (onSite(url, [ats])) {
      // job-boards.greenhouse.io/<board>/jobs/<id>, .../embed/job_app?for=<board>, jobs.ashbyhq.com/<org>/<id>
      const firstSegment = parts.pathname.replace(/^\/+|\/+$/g, "").split("/")[0];
      const board = (parts.searchParams.get("for") || firstSegment).toLowerCase();
      return [ats, board === "embed" ? "" : board];
    }
  }

  return null;
}
