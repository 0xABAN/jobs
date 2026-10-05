# Ideas

Hypotheses not yet tried, best first. Each cites evidence from a run. Mark the one being measured **(running)**, and delete an entry once its experiment is committed; git keeps the record.

- **Ashby rejects automated submissions as spam.** Run 20261004-221244-2 (Qumulo) filled the whole form in under 4 minutes, then Ashby's invisible reCAPTCHA v3 answered "flagged as possible spam ... please submit your application again". The agent ran the solver, which skips v3, and stopped. First try: on that message, wait a minute and submit again, within the 3-attempt limit. If it keeps failing: get a v3 token from CapSolver (`ReCaptchaV3EnterpriseTaskProxyLess` or `ReCaptchaV3TaskProxyLess`, with the page's site key and action) and make the page's `grecaptcha.execute` return it.
- **The skills rule clears pre-filled skills.** In run 20261004-213528-0 (Workday), turns 25–29 removed 9 skills Workday had pre-filled, because the prompt says skills pickers "stay empty". Reword it: never add skills, and leave whatever the site filled in.
- **Page rereads while waiting.** In the first 6 minutes of run 20261004-213528-0, `get_browser_state` ran 58 times at 3.1 s each, about half the agent's time, mostly rereading while a page loaded. Try waiting once for the page to change, or check whether cua-driver can read the page without a screenshot when the agent needs only refs.
- **Workday error after the resume upload.** Run 20261004-213528-0 showed "Something went wrong" after Autofill with Resume (turn 15) and recovered with a refresh. Find what triggers it: the upload method or its timing.

## Needs Adam

Things only Adam can fix, each with its run id. They stay here until he does.

- **Coursework.** Run 20261004-221244-2 (Qumulo) had a required essay on his favorite CS courses, and the agent named "Data Structures and Algorithms" and "Systems Programming in C", which are on neither the profile nor the resume. Adding his real courses to `profile.json` would stop the guessing. The Qumulo application was not submitted.
