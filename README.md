# jobs

A harness that applies to jobs for you. Give it job posting URLs. For each one, it opens the posting in a background Chrome that holds your job-site logins. A headless [Pi](https://github.com/earendil-works/pi) agent then fills in and submits the application from your profile and resume, and the harness records the result in a Google Sheet. Several applications run at once, each on a worker of its own.

This checkout is set up for its author, Adam, who develops it while applying with it. `AGENTS.md`, the apply prompt, the resumes, and a few constants describe him. To run it for yourself, follow [Set up](#set-up), then [Make it yours](#make-it-yours).

## How a run works

`uv run jobs apply <url>` takes each URL through these steps:

1. Skip it if it is on a banned site (`BANNED_SITES`).
2. Claim a free worker, then skip the job if another worker is applying to it or the tracker already settles it. Worker `n` lives in `~/.jobs/workers/<n>/`, outside the repo, so the repo's `AGENTS.md` never reaches its agent. On first use it gets a copy of your Chrome profile and its logins. A lock file there names the job it is on.
3. Open the posting in the worker's Chrome, in a background window with throttling off. The agent gets two MCP servers: read-only Gmail, for security codes and verification links, and `@playwright/mcp`, attached over this Chrome's DevTools port.
4. Run Pi headless on `src/jobs/apply/prompt.md`, filled in with the job and `profile.json`. The agent reads your resume, applies, and ends with a JSON result.
5. Record a live run in the tracker: `Apps` on success, `Failed` otherwise. Any site where the agent used or created an account goes in `Logins`, even in dry runs.
6. Print the result as one JSON line.

Each run leaves its prompt, transcript, and `result.json` in `~/.jobs/runs/<run id>/`. Prompts hold your profile, password included, so run directories are private to your user. When a run's files have gone 3 hours untouched, the next run to start deletes all of them except `result.json`.

## Requirements

- macOS. The harness launches Chrome with `open` and schedules mail cleanup with launchd, and agents make PDFs with `cupsfilter`.
- Google Chrome.
- [uv](https://docs.astral.sh/uv/), which installs the dependencies, and Python 3.12 or later if you lack it, the first time you run `uv run`.
- Node.js with `npx`, which runs the MCP servers.
- Pi: `npm install -g @earendil-works/pi-coding-agent`. Apply agents load a `write` skill from `~/.pi/agent/skills/write`; edit `SKILLS` in `src/jobs/pi.py` to drop it.
- `pdftotext`, which agents use to read resumes: `brew install poppler`.
- A Google account for Gmail and the tracker Sheet.
- Optional: a [CapSolver](https://www.capsolver.com/) API key for CAPTCHAs. If you want an orchestrating Pi session to browse job boards, you also need cua-driver.

## Set up

Run every command from the repo root.

### 1. Profile and resumes

```sh
cp profile.example.json profile.json
```

Fill in `profile.json`, which is gitignored. Agents answer application questions from it and from your resume. A required question about a hard fact, such as citizenship, criminal history, or GPA, that neither one answers ends the run with `missing_fact`, and the result names the question. A few fields need care:

- `personal.password` is the password agents use for every account they sign in to or create on employers' sites. Choose one you use nowhere else.
- `personal.email_by_employer` maps part of an employer's name to a different email to apply with there.
- `resumes.full_time` and `resumes.internship` are PDF paths relative to the repo root.
- `excluded_companies` lists employers agents must never apply to.
- `tracker.sheet_id` is set in the next step.

### 2. Tracker Sheet

Create a Google Sheet with three tabs, each with a header row. These column names must match exactly. Their order doesn't matter, and the harness leaves any other columns empty in the rows it writes.

| Tab | Columns |
|---|---|
| `Apps` | `jobs` (the company), `Role`, `Applied`, `Salary`, `URL` |
| `Failed` | `URL`, `Company`, `Role`, `Reason`, `Explanation`, `Attempts`, `Last tried`, `Run` |
| `Logins` | `Site`, `Email`, `First used`, `Last used` |

Copy the Sheet's ID, the part of its URL between `/d/` and `/edit`, into `tracker.sheet_id`.

### 3. Google OAuth client

In the Google Cloud console:

1. Create a project and enable the Gmail API, the Google Sheets API, and the Google Drive API. The Sheets MCP server uses Drive to find spreadsheets.
2. Configure the OAuth consent screen for external users, and add your Google account as a test user.
3. Create an OAuth client ID of type Desktop app and save its JSON as `.mcp/gmail-oauth.json`. The file name is historical: every Google token below uses this client.

While the app's publishing status is Testing, Google expires its refresh tokens after 7 days. Publish it ("In production") to keep them. The consent screen will then say "Google hasn't verified this app": choose Advanced, then continue.

### 4. Google tokens

Each Google client gets its own refresh token, limited to the scopes it needs. All three go in `.mcp/`, which is gitignored.

The apply agents' Gmail server gets read-only access. The server requests write access unless you pass `--scopes`:

```sh
GMAIL_OAUTH_PATH=$PWD/.mcp/gmail-oauth.json GMAIL_CREDENTIALS_PATH=$PWD/.mcp/gmail-token.json \
  npx @artymclabin/gmail-mcp@1.2.3 auth --scopes=gmail.readonly
```

The tracker token serves both the harness and the Sheets MCP server. That server has no sign-in flow of its own, so create the token with Google's library:

```sh
uv run --with google-auth-oauthlib python - <<'EOF'
import json, os
from google_auth_oauthlib.flow import InstalledAppFlow

scopes = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.file"]
credentials = InstalledAppFlow.from_client_secrets_file(".mcp/gmail-oauth.json", scopes).run_local_server(port=0)

os.umask(0o077)
with open(".mcp/google-sheets-token.json", "w") as token:
    json.dump({"refresh_token": credentials.refresh_token, "scope": " ".join(scopes)}, token)
EOF
```

The mail cleanup gets a token of its own with the `gmail.modify` scope, which can move mail to Trash but never delete it permanently. The command checks that you grant it for `personal.email`:

```sh
uv run jobs mail-auth
```

### 5. Chrome profile

`CHROME_PROFILE` in `src/jobs/config.py` is the Chrome user-data directory that holds your job-site logins, and every worker copies it. Point it wherever you like, then open it:

```sh
uv run jobs browse https://accounts.google.com
```

`jobs browse` creates the profile if it doesn't exist, opens Chrome in a window behind your apps, and prints the pid. Sign in to the Google account you apply with, to LinkedIn, and to any application sites where you already have accounts. When a site offers only single sign-on, agents use a provider you are signed in to here. Then quit that Chrome with `kill <pid>`.

Each worker copies the profile the first time it runs. To pick up new sign-ins, delete `~/.jobs/workers/*/chrome` while no jobs are running.

### 6. Pi

Create `.pi/mcp.json`, which is gitignored, with absolute paths to this repo. Each worker runs Pi from its own directory with a copy of the `gmail` entry, so relative paths would break.

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
      "cwd": "/path/to/jobs",
      "exposure": "codemode",
      "description": "Read-only Gmail search, messages, threads, labels, and attachments"
    },
    "google-sheets": {
      "command": "npx",
      "args": ["-y", "mcp-google-sheets"],
      "env": {
        "GOOGLE_SHEETS_CLIENT_ID": "!/usr/bin/jq -r .installed.client_id /path/to/jobs/.mcp/gmail-oauth.json",
        "GOOGLE_SHEETS_CLIENT_SECRET": "!/usr/bin/jq -r .installed.client_secret /path/to/jobs/.mcp/gmail-oauth.json",
        "TOKEN_PATH": "/path/to/jobs/.mcp/google-sheets-token.json"
      }
    },
    "cua-driver": {
      "command": "~/.local/bin/cua-driver",
      "args": ["mcp"],
      "exposure": "codemode",
      "description": "Control the jobs Chrome profile"
    }
  }
}
```

Apply runs need only `gmail`. The `google-sheets` and `cua-driver` servers serve an orchestrating Pi session, so leave out `cua-driver` if you don't use it.

Start `pi` here, trust the project so Pi loads `.pi/mcp.json`, and check the servers with `/mcp`. Run `/reload` after you edit the file. Then sign in with `/login` to the provider of the apply agents' model, `openai-codex/gpt-6.1-sol:low` by default. You can change that model with `MODEL` in `src/jobs/pi.py` or with `jobs apply --model`.

### 7. Optional pieces

- CAPTCHAs: add `CAPSOLVER_API_KEY=<key>` to `.env`, which is gitignored. See [CAPTCHAs](#captchas).
- Mail cleanup on a schedule: `uv run jobs mail-schedule`. See [Mail cleanup](#mail-cleanup).
- Job-board browsing by an orchestrating session: install cua-driver and grant its permissions (`cua-driver permissions grant`). Its daemon must run with `--grant existing-profile`, which `cua-driver status` reports.

### 8. Try a dry run

```sh
uv run jobs apply --dry-run <posting url>
uv run jobs timeline
```

A dry run fills in everything but never clicks Submit. It still signs in to sites and creates accounts for real, and records them in `Logins`.

## Make it yours

These files describe Adam. Change them for yourself:

| Where | What it holds |
|---|---|
| `profile.json`, `resumes/` | Your answers and resumes, from step 1. |
| `src/jobs/apply/prompt.md` | The apply agent's rules. They name Adam, and the Eligibility and Answer policy sections include his degrees, graduation date, and school sign-in. Rewrite those parts. Keep the Result section's statuses and reasons, which `result.py` and the tracker read, and the `${name}` placeholders that `prompt.py` fills in. Write `$$` for a dollar sign. |
| `src/jobs/config.py` | `CHROME_PROFILE`, `BANNED_SITES`, and `SESSION_WORKERS`. The last reserves a worker for each site where Adam signed in by hand in that worker's Chrome. Set it to `{}` unless you do the same. |
| `src/jobs/pi.py` | The apply agents' `MODEL`, the Pi `EXTENSIONS` and `SKILLS` they load, and the tools they are denied (`EXCLUDED_TOOLS`). |
| `AGENTS.md` | Instructions for an orchestrating Pi session: which jobs fit Adam, where to find them, and notes on his accounts. Replace them with your own criteria. |
| `eval/` | Adam's loop for improving the harness while it applies, and his sourcing notes. Optional. |

## Usage

Run each command as `uv run jobs <command>`:

| Command | What it does |
|---|---|
| `apply <url> ...` | Apply to jobs in parallel and print one JSON result per job. It exits with status 1 if any job failed. `--dry-run` fills in everything but never submits. `--workers` (default 6) and `--first-worker` choose the workers. `--timeout` stops an agent after that many minutes (default 60). `--model` picks its Pi model. |
| `status` | List the jobs that workers are applying to now. |
| `browse [url]` | Open the jobs Chrome profile in the background and print its pid. |
| `timeline [run id]` | Show where a run, finished or still running, spent its time. Without a run ID, it shows the latest run. |
| `clean-mail` | Move automated application receipts and codes to Gmail's Trash. `--dry-run` lists them instead. |
| `mail-auth` | Grant the mail cleanup its own Gmail token. |
| `mail-schedule` | Have launchd run `clean-mail` every 15 minutes, or every `--every` minutes. |

To apply in the background and keep a log:

```sh
nohup uv run jobs apply <url> <url> ... >> ~/.jobs/apply.log 2>&1 &
```

To retry failures, run `jobs apply` on them again. It skips failures that settle a job, such as `not_eligible`, `expired`, or `unconfirmed` (`FINAL_REASONS` in `src/jobs/tracker.py`).

You can also hand the whole process to Pi. Start `pi` in the repo root and ask it, for example, to "apply to all internships via jobright". It follows `AGENTS.md`: it finds postings, keeps the ones that fit, and starts `jobs apply` in the background.

## Details

### Workers

Every `jobs apply` process shares the same workers, and jobs beyond them wait for a free one. Each URL runs on only one worker at a time. Two Greenhouse applications to the same employer never run at once either: Greenhouse emails each one its own security code under a subject that names only the employer, so the two agents could swap codes. A job on a site in `SESSION_WORKERS` runs only on that site's worker, and other jobs leave that worker free.

### Browser tools

Apply agents drive the page with `@playwright/mcp`, whose version is pinned in `src/jobs/apply/launcher.py`. Pi denies them the Playwright tools that run Playwright code, close the tab, or change the browser, along with every Gmail tool that sends, deletes, or changes mail (`EXCLUDED_TOOLS` in `src/jobs/pi.py`). Agents keep `browser_evaluate`, and the prompt has them use it only for CAPTCHAs. An orchestrating session browses job boards in a `jobs browse` Chrome through the `cua-driver` MCP server.

### CAPTCHAs

Apply agents solve CAPTCHAs the way [ApplyPilot](https://github.com/Pickle-Pixel/ApplyPilot)'s agents do, following the CAPTCHAs section of `prompt.md`, which carries `CAPSOLVER_API_KEY`. After each page load, and after each Apply, Sign in, and Submit click, an agent runs a detect script with `browser_evaluate`. When the script finds a reCAPTCHA (v2 or v3), a Cloudflare Turnstile, an hCaptcha, or a FunCaptcha, the agent creates a CapSolver task, polls it for a token, and injects the token into the page. ApplyPilot's agents call CapSolver from the page, but Greenhouse's and Ashby's Content-Security-Policy blocks those requests, so agents here call it with `curl` from the shell. When CapSolver fails, or no key is set, agents try audio challenges and simple puzzles themselves, and otherwise fail with `captcha`. CapSolver no longer supports hCaptcha or FunCaptcha, so those CAPTCHAs fall through to that manual path. Lever's forms use hCaptcha, which is why Lever is in `BANNED_SITES`.

### Mail cleanup

Every application leaves a "thank you for applying" receipt, and many also leave a security code or a verification email. `jobs clean-mail` moves that mail to Gmail's Trash once it is 15 minutes old, which gives running agents time to read their codes. It trashes only mail from automated senders that names a company in the tracker and shows no sign of a decision, a request, or an invitation, so rejections, assessments, and interview invitations stay. It never trashes replies, forwards, or starred mail. `jobs apply` cleans about every 10 minutes while it runs, and `jobs mail-schedule` installs a launchd job that logs to `~/.jobs/mail-cleanup.log`. Trashed mail stays recoverable for 30 days.

### Timing a run

`jobs timeline` lists the launcher's phases, then splits each agent turn into model time (waiting for the first token, thinking, and writing) and tool time, including the MCP calls made inside each codemode script. It ends with the slowest calls overall. It reads the run's `result.json` and its transcript, whose events `pi.run` stamps with `t`, the number of seconds since Pi launched.

## Development

`uv run pytest` runs the tests, which need no profile, tokens, or Chrome. `eval/loop.md` describes how Adam measures changes to the prompt and the harness against live runs.
