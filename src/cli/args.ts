import { parseArgs } from "node:util";

export class UsageError extends Error {}

type Options = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

export function parse<T extends Options>(args: string[], options: T, maxPositionals = 0) {
  const parsed = parseArgs({ args, options, allowPositionals: true, strict: true });
  if (parsed.positionals.length > maxPositionals) {
    throw new UsageError(`unexpected argument: ${parsed.positionals[maxPositionals]}`);
  }
  return parsed;
}

export function number(value: string, option: string): number {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isFinite(parsed)) {
    throw new UsageError(`${option} takes a number, not ${JSON.stringify(value)}`);
  }
  return parsed;
}

export function integer(value: string, option: string): number {
  const parsed = number(value, option);
  if (!Number.isInteger(parsed)) {
    throw new UsageError(`${option} takes a whole number, not ${value}`);
  }
  return parsed;
}

export function isUsageError(error: unknown): boolean {
  const code = (error as { code?: string }).code ?? "";
  return error instanceof UsageError || code.startsWith("ERR_PARSE_ARGS");
}
