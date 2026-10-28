/** How an application ended: the JSON result an apply agent reports, validated. */

/** How one application ended; `prompt.md` defines the values the agent reports. */
export type Result = {
  status: "applied" | "dry_run" | "failed" | "skipped";  // "skipped": the agent never ran
  reason: string | null;  // why it failed or was skipped; null otherwise
  explanation: string;
  company: string | null;
  role: string | null;
  salary: string | null;  // the posted pay range, as written
  account: string | null;  // the host of the site whose account the agent used, such as a Workday tenant
};

const FIELDS = ["status", "reason", "explanation", "company", "role", "salary", "account"] as const;
const REQUIRED = ["status", "reason", "explanation"];

/** Build a result, leaving the details the agent did not report empty. */
export function result(status: Result["status"], reason: string | null, explanation: string,
  details: Partial<Pick<Result, "company" | "role" | "salary" | "account">> = {}): Result {
  return { status, reason, explanation, company: null, role: null, salary: null, account: null, ...details };
}

// The last ```json block of the agent's final message holds its result.
const RESULT_BLOCK = /```json\s*([\s\S]*?)```/g;

/** Return the result the agent ended with, or a `no_result` failure when it is missing or malformed. */
export function parseResult(finalMessage: string): Result {
  const blocks = [...finalMessage.matchAll(RESULT_BLOCK)];
  const reported = blocks.length ? parseObject(blocks.at(-1)![1]) : null;

  // Exactly the fields of a Result, with at least the required ones.
  const wellFormed = reported !== null
    && Object.keys(reported).every((key) => (FIELDS as readonly string[]).includes(key))
    && REQUIRED.every((key) => key in reported);

  if (wellFormed) {
    const candidate = { ...result("failed", null, ""), ...reported } as Result;
    const succeeded = (candidate.status === "applied" || candidate.status === "dry_run") && candidate.reason === null;
    const failed = candidate.status === "failed" && typeof candidate.reason === "string" && candidate.reason !== "";
    if (succeeded || failed) {
      return candidate;
    }
  }

  return result("failed", "no_result", `The agent ended without a valid result: ${JSON.stringify(finalMessage.slice(-300))}`);
}

function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
