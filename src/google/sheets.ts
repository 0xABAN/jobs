import { join } from "node:path";

import { REPO_ROOT } from "../shared/config.ts";
import type { HttpError } from "./errors.ts";
import { call } from "./http.ts";

export const TOKEN = join(REPO_ROOT, ".mcp/google-sheets-token.json");
export const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"];

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const RETRYABLE_READ_STATUSES = [500, 502, 503];
const THROTTLED = 429;
const HEADER_ROWS = 1;

export type Row = Record<string, string | number | null | undefined>;
export type SheetRow = Record<string, string>;

export class Sheet {
  url: string;

  constructor(sheetId: string) {
    this.url = `${API}/${sheetId}`;
  }

  async rows(tab: string): Promise<SheetRow[]> {
    const [header, ...rows]: string[][] = (await this.call("GET", `/values/${encodeRange(tab)}`)).values ?? [[]];
    return rows.map((cells) => Object.fromEntries(header.slice(0, cells.length).map((column, i) => [column, cells[i]])));
  }

  async find(tab: string, column: string, value: string): Promise<[number | null, SheetRow]> {
    const rows = await this.rows(tab);
    const index = rows.findIndex((row) => row[column] === value);
    return index === -1 ? [null, {}] : [index + HEADER_ROWS + 1, rows[index]];
  }

  async append(tab: string, row: Row): Promise<void> {
    await this.call("POST", `/values/${encodeRange(tab)}:append?valueInputOption=RAW`, { values: [await this.cells(tab, row)] });
  }

  async update(tab: string, number: number, row: Row): Promise<void> {
    const range = encodeRange(`${tab}!A${number}`);
    await this.call("PUT", `/values/${range}?valueInputOption=RAW`, { values: [await this.cells(tab, row)] });
  }

  async delete(tab: string, number: number): Promise<void> {
    const { sheets } = await this.call("GET", "?fields=sheets.properties(sheetId,title)");
    const sheetId = sheets.find((sheet: any) => sheet.properties.title === tab).properties.sheetId;
    const rows = { sheetId, dimension: "ROWS", startIndex: number - 1, endIndex: number };
    await this.call("POST", ":batchUpdate", { requests: [{ deleteDimension: { range: rows } }] });
  }

  call(method: string, path: string, body?: unknown): Promise<any> {
    const retryable = (error: HttpError) =>
      error.status === THROTTLED || (method === "GET" && RETRYABLE_READ_STATUSES.includes(error.status));
    return call(this.url + path, TOKEN, { method, body, retryable });
  }

  private async cells(tab: string, row: Row): Promise<(string | number)[]> {
    const header: string[] = (await this.call("GET", `/values/${encodeRange(`${tab}!1:1`)}`)).values[0];
    return header.map((column) => row[column] ?? "");
  }
}

function encodeRange(a1: string): string {
  return encodeURIComponent(a1).replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase());
}
