/**
 * A minimal Google Sheets client whose rows are objects keyed by each tab's header row.
 *
 * Callers never depend on column order: that lives in the Sheet. Credentials are the
 * Sheets MCP server's: the Desktop OAuth client and its refresh token in `.mcp/`.
 */

import { join } from "node:path";

import { REPO_ROOT } from "./config.ts";
import * as google from "./google.ts";
import type { HttpError } from "./google.ts";

export const TOKEN = join(REPO_ROOT, ".mcp/google-sheets-token.json");
export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"];

/** A row's cells by their column's header. Numbers are written as numbers; cells are read back as text. */
export type Row = Record<string, string | number | null | undefined>;

export class Sheet {
  url: string;

  constructor(sheetId: string) {
    this.url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  }

  /** Return every row of `tab` below the header, keyed by the header row. */
  async rows(tab: string): Promise<Record<string, string>[]> {
    const [header, ...rows]: string[][] = (await this.call("GET", `/values/${range(tab)}`)).values ?? [[]];

    return rows.map((cells) => {
      const row: Record<string, string> = {};
      for (let i = 0; i < Math.min(header.length, cells.length); i++) {
        row[header[i]] = cells[i];
      }
      return row;
    });
  }

  /** Return the row number and contents of the first row in `tab` whose `column` is `value`, or `[null, {}]`. */
  async find(tab: string, column: string, value: string): Promise<[number | null, Record<string, string>]> {
    const rows = await this.rows(tab);
    const index = rows.findIndex((row) => row[column] === value);
    return index === -1 ? [null, {}] : [index + 2, rows[index]];  // row 1 is the header
  }

  async append(tab: string, row: Row): Promise<void> {
    await this.call("POST", `/values/${range(tab)}:append?valueInputOption=RAW`, { values: [await this.cells(tab, row)] });
  }

  async update(tab: string, number: number, row: Row): Promise<void> {
    await this.call("PUT", `/values/${range(`${tab}!A${number}`)}?valueInputOption=RAW`, { values: [await this.cells(tab, row)] });
  }

  async delete(tab: string, number: number): Promise<void> {
    const { sheets } = await this.call("GET", "?fields=sheets.properties(sheetId,title)");
    const sheetId = sheets.find((sheet: any) => sheet.properties.title === tab).properties.sheetId;
    const rows = { sheetId, dimension: "ROWS", startIndex: number - 1, endIndex: number };
    await this.call("POST", ":batchUpdate", { requests: [{ deleteDimension: { range: rows } }] });
  }

  /** Order `row`'s values by `tab`'s header row. */
  private async cells(tab: string, row: Row): Promise<(string | number)[]> {
    const header: string[] = (await this.call("GET", `/values/${range(`${tab}!1:1`)}`)).values[0];
    return header.map((column) => row[column] ?? "");
  }

  /**
   * Call the Sheets API, retrying throttled calls (429) and failed reads.
   *
   * Sheets allows about 60 reads a minute per user, and many workers starting at once exceed it.
   * Server errors are retried only for reads: a write may have gone through.
   */
  call(method: string, path: string, body?: unknown): Promise<any> {
    const retryable = (error: HttpError) => error.status === 429 || (method === "GET" && [500, 502, 503].includes(error.status));
    return google.call(this.url + path, TOKEN, { method, body, retryable });
  }
}

/** Percent-encode an A1 range for a URL path: every character but letters, digits, and `_.-~`, so `Apps!1:1` is `Apps%211%3A1`. */
function range(a1: string): string {
  return encodeURIComponent(a1).replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
}
