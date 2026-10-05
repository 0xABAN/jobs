adam's harness for job applications

Run `pi` from this repository root. Trust the project to load local MCP servers
from `.pi/mcp.json`; inspect their connections with `/mcp` inside Pi.

The MCP configuration and credentials under `.mcp/` are local and gitignored.
Run `/reload` in an existing Pi session after changing the MCP configuration.

Browser control uses the `cua-driver` MCP server on this Mac (`cua-driver mcp`).
Its daemon must run with `--grant existing-profile` (`cua-driver status`), so it
can attach to the Chrome the launcher starts.

## Apply to jobs

Copy `profile.example.json` to `profile.json` and fill it in; it is gitignored.
Then apply:

    uv run jobs apply <url> [<url> ...] --dry-run [--workers 3] [--model claude-bridge/claude-opus-5-5:medium] [--timeout 60]

Jobs run in parallel on N workers, shared by every `jobs apply` process; extra
jobs wait for a free one. Worker `n` lives in `~/.jobs/workers/<n>/`: a copy of
the `jobs` Chrome profile and its logins (delete `chrome/` there to recopy after
new logins), the directory its Pi agent runs in, outside the repo so this repo's
`AGENTS.md` never reaches it, and a lock file naming the job it is on
(`uv run jobs status` lists them).

For each job, the launcher skips URLs on a banned site (`BANNED_SITES` in
`src/jobs/config.py`), the tracker already settles, or another worker is on, opens
the job in a background Chrome with throttling off, runs a headless Pi agent on
`src/jobs/apply/prompt.md` filled in with the job and `profile.json`, and prints
the agent's JSON result. Live runs are recorded in the tracker Sheet: `Apps` on
success, `Failed` (one row per URL) otherwise. Every run, dry or live, lists the
site of any account its agent used or created in `Logins`; all of them use the
profile's email and password. Each run leaves its prompt, transcript, and result
in `~/.jobs/runs/<run id>/`; the next run to start after 3 hours deletes all but
the result. Drop `--dry-run` to submit.

`uv run jobs browse <url>` opens the `jobs` profile itself, for browsing job boards.

`uv run jobs timeline [run id]` shows where a run, finished or running, spent its
time: the launcher's phases, then each agent turn split into model time (waiting for
the first token, thinking, writing) and tool time, with the CUA calls inside each
codemode script, and the slowest calls overall. It reads `result.json` and the
transcript, whose events `pi.run` stamps with `t`, the seconds since Pi launched.

When a reCAPTCHA (v2, invisible v2, Enterprise) or Cloudflare Turnstile blocks an
apply agent, it runs `uv run jobs captcha <devtools port>`, which finds the CAPTCHA
through Chrome's DevTools protocol, has CapSolver solve it, and injects the token.
It needs `CAPSOLVER_API_KEY` in `.env`. CapSolver cannot solve hCaptcha, which is
why Lever is banned, and score-based reCAPTCHA v3 has nothing to solve.

Run the tests with `uv run pytest`.

Gmail uses `@artymclabin/gmail-mcp@1.2.3` with the `gmail.readonly` OAuth scope.
Its files are `.mcp/gmail-oauth.json` (OAuth client) and `.mcp/gmail-token.json`
(tokens). Reauthentication must include `--scopes=gmail.readonly`; the server
requests write access by default:

    GMAIL_OAUTH_PATH=$PWD/.mcp/gmail-oauth.json GMAIL_CREDENTIALS_PATH=$PWD/.mcp/gmail-token.json \
      npx @artymclabin/gmail-mcp@1.2.3 auth --scopes=gmail.readonly

Google Sheets (`mcp-google-sheets`) reads the same Desktop OAuth client from
`.mcp/gmail-oauth.json` and its token from `.mcp/google-sheets-token.json`
(`spreadsheets` and `drive.file` scopes). The server has no sign-in flow of its
own, so a new token needs a loopback OAuth flow with that client.

The Google Cloud app is published ("In production"), so refresh tokens no longer
expire after 7 days; its privacy policy is https://advm.dev/privacy. Consent
screens show "Google hasn't verified this app": choose Advanced, then continue.
