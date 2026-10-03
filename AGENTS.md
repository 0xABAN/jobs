Adam's job-application harness. Agent files live in `src/core/`. Do not invent extra pipeline.

| What | Where |
| --- | --- |
| Default resume | `src/resume/default/Adam_Torres_Encarnacion_Resume.pdf` (source `.tex`) |
| Masters resume | `src/resume/masters/Adam_Torres_Encarnacion_Resume_Masters.pdf` (source `.tex`) |
| Apply playbook | `src/core/apply.md` |
| Tracker | Google Sheet `1ZghuMB16Qc1fIMrLCSAQkkBWDymTYGlx1_hR0RTsP_I` tab `Apps` |
| Secrets | `.env` — never print |
| Local MCPs | `.pi/mcp.json` — Google Sheets and read-only Gmail |

Never read or print credential-bearing MCP files, including `.pi/mcp.json` when it contains token material, `.mcp-google-sheets-token.json`, and files under `.mcp/`. If secret material appears in tool output, stop immediately, do not repeat it, and tell the user which file needs credential rotation.

Resume builds: run `latexmk -pdf <filename>.tex && latexmk -c <filename>.tex` from the relevant resume folder. Keep only `.tex` sources and final `.pdf` files; remove leftover build logs such as `missfont.log`. Use lowercase `-c`, never `-C`, which also deletes PDFs.

Apply: Codex computer-use + Jobright (`apply.md`). Log every application attempt on the sheet. Adam's active autonomous-application goal authorizes submitting completed applications for roles in that goal without pausing for routine approval. Pause only for a CAPTCHA, a legally binding agreement, or a required answer that is genuinely missing or ambiguous; never invent an answer.

At the start of every application task, read the local-only `src/core/apply.md` for Adam's profile and application playbook. Treat only explicitly confirmed entries as answers; ask Adam about missing or ambiguous answers, especially legal, work-authorization, and voluntary demographic questions. Do not infer or autofill those answers from browser profiles.

Tracker convention: When Adam says to track, add, or enter a job, he is reporting an application already submitted. All entries in the tracker are applied jobs, not a shortlist; do not leave their application status unconfirmed. Preserve existing application dates and use an explicitly supplied date when available. For a new tracking request without a separate date, use the request date and note that it is the recorded date. For historical entries with unknown submission dates, mark `Applied` without inventing a date. Logging an application is not authorization to submit one.
