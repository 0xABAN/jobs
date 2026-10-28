import { homedir } from "node:os";
import { join } from "node:path";

export const MODEL = "openai-codex/gpt-6.1-sol:low";

export const EXTENSIONS = ["builtin:mcp", "builtin:codemode"];

export const SKILLS = [join(homedir(), ".pi/agent/skills/write")];

const BLOCKED_BROWSER_TOOLS = ["run_code_unsafe", "close", "resize", "emulate_media", "network_requests", "network_request",
  "console_messages"];

const BLOCKED_GMAIL_TOOLS = ["send_email", "draft_email", "update_draft", "send_draft", "delete_draft", "reply_all",
  "delete_email", "batch_delete_emails", "modify_email", "batch_modify_emails", "modify_thread", "report_phishing",
  "batch_report_phishing", "create_label", "update_label", "delete_label", "get_or_create_label", "create_filter",
  "create_filter_from_template", "delete_filter", "download_attachment", "download_email"];

export const EXCLUDED_TOOLS = [
  ...BLOCKED_BROWSER_TOOLS.map((name) => `mcp__playwright__browser_${name}`),
  ...BLOCKED_GMAIL_TOOLS.map((name) => `mcp__gmail__${name}`),
].join(",");
