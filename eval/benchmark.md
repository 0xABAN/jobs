# Benchmark

Each pass runs 3 live applications, one each on Workday, Greenhouse, and Ashby, taken from the queue (`sourcing.md`), and the 4 fixed dry runs below. Any edit here changes the benchmark, so it gets its own commit and is followed by a new baseline.

## Fixed dry runs

| Id | URL | Expect | Why |
|---|---|---|---|
| `ref-greenhouse` | https://job-boards.greenhouse.io/figma/jobs/5691911004 | `dry_run` | Figma, Software Engineer - Full Stack: 20 questions, one required essay. Adam applied in August, so dry runs cost him no opportunity. |
| `ref-ashby` | https://jobs.ashbyhq.com/notion/e32799d2-8ef8-4803-8189-c72514afa816 | `dry_run` | Notion, Software Engineer, New Grad (Dec 2026). Adam applied on September 25. |
| `control-expired` | https://job-boards.greenhouse.io/robinhood/jobs/1000001 | `expired` | No such job. Greenhouse redirects to the board with an error, as it does for closed postings. |
| `control-ineligible` | https://job-boards.greenhouse.io/pinterest/jobs/8140389 | `not_eligible` | Pinterest, Master's University Grad Data Scientist: requires a master's by August 2027, and Adam's comes in May 2028. It opens on Pinterest's own careers page. |

Greenhouse and Ashby keep no state between visits, so these runs repeat exactly. Workday saves every draft and candidates cannot delete them, so a fixed Workday run would resume its last draft; Workday is measured on live runs only. When a fixed posting closes, replace it with one of the same kind; a reference should be a posting Adam already applied to.
