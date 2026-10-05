# Benchmark

Each pass runs 6 fresh live applications and the 4 fixed dry runs below. Any edit here changes the benchmark, so it gets its own commit and is followed by a new baseline.

## Fixed dry runs

| Id | URL | Expect | Why |
|---|---|---|---|
| `ref-greenhouse` | https://job-boards.greenhouse.io/figma/jobs/5691911004 | `dry_run` | Figma, Software Engineer - Full Stack: 20 questions, one required essay. Adam applied in August, so dry runs cost him no opportunity. |
| `ref-ashby` | https://jobs.ashbyhq.com/notion/e32799d2-8ef8-4803-8189-c72514afa816 | `dry_run` | Notion, Software Engineer, New Grad (Dec 2026). Adam applied on September 25. |
| `control-expired` | https://job-boards.greenhouse.io/robinhood/jobs/1000001 | `expired` | No such job. Greenhouse redirects to the board with an error, as it does for closed postings. |
| `control-ineligible` | https://job-boards.greenhouse.io/pinterest/jobs/8140389 | `not_eligible` | Pinterest, Master's University Grad Data Scientist: requires a master's by August 2027, and Adam's comes in May 2028. It opens on Pinterest's own careers page. |

Greenhouse and Ashby keep no state between visits, so these runs repeat exactly. Workday saves every draft and candidates cannot delete them, so a fixed Workday run would resume its last draft; Workday is measured on live runs only. When a fixed posting closes, replace it with one of the same kind; a reference should be a posting Adam already applied to.

## Live postings

Each pass takes 2 Workday, 2 Greenhouse, and 2 Ashby postings that are:
- New-grad roles or internships in the U.S. in data science, machine learning, AI, analytics, or software engineering, which Adam is eligible for under the prompt's Eligibility section.
- Not at a company in `excluded_companies`, not in the tracker's `Apps` tab under the same company and role, not settled in `Failed`, and not a fixed posting above.
- At most one per company in a pass.

If an ATS runs short, fill in with the others and note it in the record.

The ATSs' public APIs list postings without a browser. Use `.venv/bin/python`; the system Python lacks CA certificates.
- **Greenhouse:** `GET https://boards-api.greenhouse.io/v1/boards/<board>/jobs`. For one job's requirements and form questions, add `/<id>?questions=true`. Apply at `https://job-boards.greenhouse.io/<board>/jobs/<id>`, which redirects to the employer's page when it has one.
- **Ashby:** `GET https://api.ashbyhq.com/posting-api/job-board/<org>` returns each job's `jobUrl` and `descriptionPlain`.
- **Workday:** `POST https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` with `{"searchText": "...", "limit": 20, "offset": 0, "appliedFacets": {}}`. For details, `GET` the same URL with `/jobs` replaced by a posting's `externalPath`. Apply at `https://<tenant>.<wdN>.myworkdayjobs.com/en-US/<site><externalPath>`.

Sources with matching postings in October 2026; add more as you find them:
- **Greenhouse boards:** robinhood, figma, coinbase, stripe, pinterest, lyft, affirm, datadog, databricks, cloudflare, samsara, point72, imc.
- **Ashby orgs:** ramp, notion, openai, cohere, replit, harvey, sierra, modal, perplexity.
- **Workday (tenant, host, site):** adobe wd5 external_experienced; nvidia wd5 NVIDIAExternalCareerSite; amat wd1 External; pnc wd5 External; capitalone wd12 Capital_One; salesforce wd12 External_Career_Site; intel wd1 External; mastercard wd1 CorporateCareers.
