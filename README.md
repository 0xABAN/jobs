adam's harness for job applications

Run `pi` from this repository root. Trust the project to load local MCP servers
from `.pi/mcp.json`; inspect their connections with `/mcp` inside Pi.

The MCP configuration and credentials under `.mcp/` are local and gitignored.
Run `/reload` in an existing Pi session after changing the MCP configuration.

Browser control uses the `cua-driver` MCP server on this Mac (`cua-driver mcp`),
which needs the CuaDriver daemon running (`cua-driver status`). Each application
launches the CUA-owned `jobs` Chrome profile itself; see `src/jobs/apply/prompt.md`.

## Apply to a job

Copy `profile.example.json` to `profile.json` and fill it in; it is gitignored.
Then print the prompt for one job:

    uv run jobs prompt <url> --dry-run

The prompt is self-contained: `src/jobs/apply/prompt.md` filled in with the job, the
profile, and the text of both resumes, which `pdftotext` (from Poppler) extracts.
Ask Pi to apply, or run the prompt yourself; drop `--dry-run` to submit.

Run the tests with `uv run pytest`.

Gmail uses `@artymclabin/gmail-mcp@1.2.3` with the `gmail.readonly` OAuth scope.
Its files are `.mcp/gmail-oauth.json` (OAuth client) and `.mcp/gmail-token.json`
(tokens). Reauthentication must include `--scopes=gmail.readonly`; the server
requests write access by default.
