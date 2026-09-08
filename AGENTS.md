Adam's job-application harness. Discover, then apply. Do not invent extra pipeline.

| What | Where |
| --- | --- |
| Default resume | `src/resume/default/Adam_Torres_Encarnacion_Resume.pdf` (source `.tex`) |
| Masters resume | `src/resume/masters/Adam_Torres_Encarnacion_Resume_Masters.pdf` (source `.tex`) |
| Company allowlist | `src/core/orgs.txt` |
| Apply playbook | `src/core/apply.md` |
| Discovery skill | `.agents/skills/use-fantastic-jobs/SKILL.md` |
| Tracker | Google Sheet `1ZghuMB16Qc1fIMrLCSAQkkBWDymTYGlx1_hR0RTsP_I` tab `Apps` |
| Secrets | `.env` — never print |
| Sheets MCP | `.mcp.json` |

Never read or print credential-bearing MCP files, including `.mcp.json` when it contains token material, `.mcp-google-sheets-token.json`, and files under `.mcp/`. If secret material appears in tool output, stop immediately, do not repeat it, and tell the user which file needs credential rotation.

Resume builds: run `latexmk -pdf <filename>.tex && latexmk -c <filename>.tex` from the relevant resume folder. Keep only `.tex` sources and final `.pdf` files; remove leftover build logs such as `missfont.log`. Use lowercase `-c`, never `-C`, which also deletes PDFs.

Discovery: Fantastic.jobs ATS API (`use-fantastic-jobs`). Apply: Codex computer-use + Jobright (`apply.md`). Log every attempt on the sheet. Never submit without user approval.
