adam's harness for job applications

Run `pi` from this repository root. Trust the project to load local MCP servers
from `.pi/mcp.json`; inspect their connections with `/mcp` inside Pi.

The MCP configuration and credentials under `.mcp/` are local and gitignored.
Run `/reload` in an existing Pi session after changing the MCP configuration.

Browser control uses the `cua-driver` MCP server on this Mac (`cua-driver mcp`).
Its daemon must run with `--grant existing-profile` (`cua-driver status`), so it
can attach to the Chrome the launcher starts.

## Apply to a job

Copy `profile.example.json` to `profile.json` and fill it in; it is gitignored.
Then apply to one job:

    uv run jobs apply <url> --dry-run [--model claude-sonnet-5-5:low] [--timeout 15]

The launcher opens the job in a background Chrome on the `jobs` profile with
throttling off, runs a headless Pi agent on `src/jobs/apply/prompt.md` filled in
with the job and `profile.json`, and prints the agent's JSON result. Pi runs from
`~/.jobs/workers/0`, outside the repo, so this repo's `AGENTS.md` never reaches it.
Each run leaves its prompt, transcript, and result in `~/.jobs/runs/<run id>/`.
Drop `--dry-run` to submit.

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
