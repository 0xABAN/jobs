# Ideas

Hypotheses not yet tried, best first. Each cites evidence from a run. Mark the one being measured **(running)**, and delete an entry once its experiment is committed; git keeps the record.

- **The skills rule clears pre-filled skills.** In run 20261004-213528-0 (Workday), turns 25–29 removed 9 skills Workday had pre-filled, because the prompt says skills pickers "stay empty". Reword it: never add skills, and leave whatever the site filled in.
- **Page rereads while waiting.** In the first 6 minutes of run 20261004-213528-0, `get_browser_state` ran 58 times at 3.1 s each, about half the agent's time, mostly rereading while a page loaded. Try waiting once for the page to change, or check whether cua-driver can read the page without a screenshot when the agent needs only refs.
- **Workday error after the resume upload.** Run 20261004-213528-0 showed "Something went wrong" after Autofill with Resume (turn 15) and recovered with a refresh. Find what triggers it: the upload method or its timing.

## Needs Adam

Things only Adam can fix, each with its run id. They stay here until he does.
