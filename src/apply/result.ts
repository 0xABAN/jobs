export type Status = "applied" | "dry_run" | "failed" | "skipped";

export type Result = {
  status: Status;
  reason: string | null;
  explanation: string;
  company: string | null;
  role: string | null;
  salary: string | null;
  account: string | null;
};

type Details = Partial<Pick<Result, "company" | "role" | "salary" | "account">>;

const FIELDS = new Set(["status", "reason", "explanation", "company", "role", "salary", "account"]);
const REQUIRED_FIELDS = ["status", "reason", "explanation"];
const RESULT_BLOCK = /```json\s*([\s\S]*?)```/g;
const QUOTED_TAIL = 300;

export function result(status: Status, reason: string | null, explanation: string, details: Details = {}): Result {
  return { status, reason, explanation, company: null, role: null, salary: null, account: null, ...details };
}

export function parseResult(finalMessage: string): Result {
  const lastBlock = [...finalMessage.matchAll(RESULT_BLOCK)].at(-1);
  const reported = lastBlock ? parseObject(lastBlock[1]) : null;

  if (reported && hasExactlyResultFields(reported)) {
    const candidate = { ...result("failed", null, ""), ...reported } as Result;
    if (isFinished(candidate)) {
      return candidate;
    }
  }

  return result("failed", "no_result", `The agent ended without a valid result: ${JSON.stringify(finalMessage.slice(-QUOTED_TAIL))}`);
}

function hasExactlyResultFields(reported: Record<string, unknown>): boolean {
  return Object.keys(reported).every((key) => FIELDS.has(key)) && REQUIRED_FIELDS.every((key) => key in reported);
}

function isFinished(candidate: Result): boolean {
  const succeeded = (candidate.status === "applied" || candidate.status === "dry_run") && candidate.reason === null;
  const failed = candidate.status === "failed" && typeof candidate.reason === "string" && candidate.reason !== "";
  return succeeded || failed;
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
