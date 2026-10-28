export class HttpError extends Error {
  status: number;
  body: string;
  retryAfter: string | null;

  constructor(url: string, status: number, body: string, retryAfter: string | null = null) {
    super(`HTTP ${status} from ${url}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

const NETWORK_FAILURES = ["fetch failed", "terminated"];

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return NETWORK_FAILURES.includes(error.message);
  }
  return error instanceof DOMException && error.name === "TimeoutError";
}
