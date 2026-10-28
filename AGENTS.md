This repo applies to jobs from their posting URLs. Use it through `./jobs`; `./jobs --help` lists every command and option. Finding postings is not part of this repo.

## Applying

- Start applications in the background and keep working: `nohup ./jobs apply <url> <url> ... >> ~/.jobs/apply.log 2>&1 &`. Up to 6 run at once (`--workers`), each on a worker of its own in `~/.jobs/workers/<n>/`, and extra URLs wait for a free one. `--dry-run` never submits, but still signs in and creates accounts.
- Each job is first checked against the tracker Sheet. A headless agent then applies, and the result goes to the `Apps` tab on success or `Failed` otherwise. `Logins` lists the sites where agents used or created an account. `~/.jobs/apply.log` gets one JSON line per finished job.
- `./jobs status` lists what the workers are applying to now, and `./jobs timeline [run id]` shows where a run spent its time. Each run keeps its prompt, transcript, and `result.json` in `~/.jobs/runs/<run id>/`; everything but `result.json` is deleted after 3 hours.
- To retry failures, run `./jobs apply` again on URLs from `Failed`. Failures that settle a job (`FINAL_REASONS` in `src/tracker/tracker.ts`, such as `not_eligible`) are skipped. Retry `missing_fact` and `login_issue` only after Adam updates `profile.json` or signs in again.
- Apply only through `./jobs apply`, never in your own browser.

## Accounts and mail

- `./jobs browse [url]` opens the jobs Chrome profile (`~/.jobs/chrome`), which holds Adam's job-site logins, and prints its pid; `kill` that pid when you are done. Each worker copies this profile on first use.
- Workers 4 and 5 hold sign-ins Adam made by hand, and `SESSION_WORKERS` in `src/shared/config.ts` routes those sites' jobs to them: Y Combinator (Work at a Startup) on worker 4, and Microsoft Careers with his Gmail on worker 5. Apple's sign-in lapsed, so Adam applies to Apple roles himself. When a session lapses, its runs fail with `login_issue`; ask Adam to sign in again in a Chrome opened on that worker's profile.
- Mail to `personal.school_email` no longer reaches Gmail, so agents never see codes or reset links sent there. Read that inbox in Outlook web through the jobs profile: `./jobs browse https://outlook.office.com/mail/`.
- `./jobs clean-mail` trashes application receipts and security codes at least 15 minutes old, and `--dry-run` lists what it would trash. `./jobs mail-schedule` runs it every 15 minutes, and `./jobs apply` also cleans while it runs.

## Files

- `profile.json` (gitignored; `profile.example.json` shows its shape) holds Adam's answers, and `resumes/` his resumes.
- `src/apply/prompt.md` is the apply agent's instructions.
- `src/shared/config.ts` holds the paths, `BANNED_SITES` (sites agents never apply on; today, Lever), and `SESSION_WORKERS`.

## Development

Run `npm test` and `npm run typecheck`.
