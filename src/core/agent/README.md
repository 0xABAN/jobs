# Agent

Bare Pi profile, using the same native MCP and Claude Bridge setup as
`~/dev/configs/pi`. No discovery integration, application workflow, or
autonomous loop is configured.

## Start

Requires Pi 1.0.0 and Claude Code for the Claude provider. From the repository
root:

```sh
PI_CODING_AGENT_DIR="$PWD/src/core/agent" pi \
  --no-context-files --no-skills --no-prompt-templates --no-themes
```

The dedicated agent directory replaces the personal Pi profile. The flags
keep existing repository instructions, Fantastic.jobs, and unrelated skills
out of this bare session. This is configuration isolation, not a VM sandbox.

Use Pi's `/login` for OpenAI Codex and Claude Code's own login for Claude
Bridge. Select a model with `/model`; no default model is chosen here.
Authentication is local and is not copied from the host profile. Pi installs
the pinned Claude Bridge package when this profile is first loaded.

## MCP

`mcp.json` is the native Pi MCP configuration and starts with no servers.
Add server definitions here when their responsibilities are agreed. Reference
credentials through environment variables or a private credential store;
never put literal secrets in this tracked file.

Only the four profile files are tracked. Credentials, installed packages,
sessions, and other runtime files in this directory are ignored.
