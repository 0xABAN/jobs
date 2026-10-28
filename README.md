# jobs

Applies to jobs for you. For each posting URL, it opens the posting in a background Chrome that holds your job-site logins, and a headless [Pi](https://github.com/earendil-works/pi) agent fills in and submits the application from your profile and resume. The result goes into a Google Sheet. Several applications run at once, each on a worker of its own.

This checkout is set up for its author, Adam. To use it yourself, follow [Setup](#setup), then [Make it yours](#make-it-yours).

## Requirements

- macOS and Google Chrome.
- Node.js 22.18 or later. It runs the harness without any packages, and runs Pi and the MCP servers.
- Pi: `npm install -g @earendil-works/pi-coding-agent`.
- `pdftotext`, for reading resumes: `brew install poppler`.
- A Google account for Gmail and the tracker Sheet.
- Optional: a [CapSolver](https://www.capsolver.com/) key for CAPTCHAs.

## Setup

1. **Profile.** Copy `profile.example.json` to `profile.json` and fill it in. Agents use `personal.password` for every employer account they sign in to or create, so make it one you use nowhere else.
2. **Tracker.** Create a Google Sheet with these tabs and header rows, and put its ID in `tracker.sheet_id`:

   | Tab | Columns |
   |---|---|
   | `Apps` | `jobs` (the company), `Role`, `Applied`, `Salary`, `URL` |
   | `Failed` | `URL`, `Company`, `Role`, `Reason`, `Explanation`, `Attempts`, `Last tried`, `Run` |
   | `Logins` | `Site`, `Email`, `First used`, `Last used` |

3. **Google OAuth.** In Google Cloud, enable the Gmail, Sheets, and Drive APIs and create a Desktop OAuth client. Save its JSON as `.mcp/gmail-oauth.json`, and publish the app so its refresh tokens last longer than 7 days.
4. **Tokens.** Each one holds only the scopes it needs:
   - Read-only Gmail for the agents: `GMAIL_OAUTH_PATH=$PWD/.mcp/gmail-oauth.json GMAIL_CREDENTIALS_PATH=$PWD/.mcp/gmail-token.json npx @artymclabin/gmail-mcp@1.2.3 auth --scopes=gmail.readonly`
   - The tracker: `./jobs sheets-auth`
   - The mail cleanup, which can move mail to Trash: `./jobs mail-auth`
5. **Chrome.** `./jobs browse https://accounts.google.com` opens the profile at `paths.chromeProfile` (`src/shared/config.ts`) and prints its pid. Sign in to Google, LinkedIn, and any application sites, then `kill` that pid. Each worker copies this profile on first use.
6. **Pi.** Create `.pi/mcp.json` with absolute paths, since agents run from their worker's directory:

   ```json
   {
     "mcpServers": {
       "gmail": {
         "command": "npx",
         "args": ["--yes", "--ignore-scripts", "@artymclabin/gmail-mcp@1.2.3"],
         "env": {
           "GMAIL_OAUTH_PATH": "/path/to/jobs/.mcp/gmail-oauth.json",
           "GMAIL_CREDENTIALS_PATH": "/path/to/jobs/.mcp/gmail-token.json"
         },
         "exposure": "codemode"
       }
     }
   }
   ```

   Run `pi` here, trust the project, and `/login` to the provider of the agents' model (`MODEL` in `src/agent/settings.ts`).
7. **Optional.** Put `CAPSOLVER_API_KEY=<key>` in `.env`, and run `./jobs mail-schedule` to clean mail every 15 minutes.

Then try `./jobs apply --dry-run <posting url>` followed by `./jobs timeline`.

## Usage

| Command | What it does |
|---|---|
| `./jobs apply <url> ...` | Apply in parallel and print one JSON line per job. `--dry-run` never submits, but still signs in and creates accounts. |
| `./jobs status` | List the jobs workers are on now. |
| `./jobs timeline [run id]` | Show where a run spent its time. |
| `./jobs browse [url]` | Open the jobs Chrome profile and print its pid. |
| `./jobs clean-mail` | Trash application receipts and security codes at least 15 minutes old. |

`./jobs --help` lists every option. To run in the background, use `nohup ./jobs apply <url> ... >> ~/.jobs/apply.log 2>&1 &`. Running `apply` again retries failures, except those that settle a job (`FINAL_REASONS` in `src/tracker/tracker.ts`). Each run keeps its prompt, transcript, and `result.json` in `~/.jobs/runs/<run id>/`, and everything but `result.json` is deleted after 3 hours.

## How it works

Each URL claims one of the shared workers in `~/.jobs/workers/<n>/`, unless the tracker already settles it or another worker has it. The worker's Chrome opens the posting in a background window, and Pi runs `src/apply/prompt.md` with two MCP servers: read-only Gmail for codes and links, and `@playwright/mcp` on Chrome's DevTools port. Agents solve CAPTCHAs with CapSolver, as ApplyPilot's agents do. Lever is banned because its hCaptcha can't be solved. Live results go to `Apps` or `Failed`, and accounts agents used go to `Logins`.

## Make it yours

| File | What it holds |
|---|---|
| `profile.json`, `resumes/` | Your answers and resumes. |
| `src/apply/prompt.md` | The agent's rules, which name Adam and his degrees. Keep the Result section and the `${name}` placeholders, and write `$$` for a dollar sign. |
| `src/shared/config.ts` | `paths.chromeProfile`, `BANNED_SITES`, and `SESSION_WORKERS`, the workers kept for sites Adam signed in to by hand. Empty the last one. |
| `src/agent/settings.ts` | The agents' model, extensions, skills, and blocked tools. |
| `AGENTS.md` | How an agent working in this checkout uses the harness. |

## Development

`npm test` runs the tests without an install, a profile, or Chrome. For type checking, run `npm install`, then `npm run typecheck`. The code is grouped by domain under `src/`: `cli`, `apply`, `workers`, `agent`, `browser`, `runs`, `tracker`, `mail`, `google`, and `shared`.
