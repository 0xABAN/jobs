adam's harness for job applications

Run `pi` from this repository root. Trust the project to load local MCP servers
from `.pi/mcp.json`; inspect their connections with `/mcp` inside Pi.

The MCP configuration and credentials under `.mcp/` are local and gitignored.
Run `/reload` in an existing Pi session after changing the MCP configuration.

Browser control uses the `cua-driver` MCP server on this Mac (`cua-driver mcp`),
which needs the CuaDriver daemon running (`cua-driver status`). Each application
launches the CUA-owned `jobs` Chrome profile itself; see `src/core/apply.md`.

Gmail uses `@artymclabin/gmail-mcp@1.2.3` with the `gmail.readonly` OAuth scope.
Its files are `.mcp/gmail-oauth.json` (OAuth client) and `.mcp/gmail-token.json`
(tokens). Reauthentication must include `--scopes=gmail.readonly`; the server
requests write access by default.
