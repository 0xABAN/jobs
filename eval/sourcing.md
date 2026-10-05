# Sourcing

While a pass runs, sourcing is your main work: keep the queue stocked so every pass starts at once, with the jobs Adam should most want at the top. `AGENTS.md` steps 2 and 3 say which jobs fit and which to drop. When in doubt, queue it.

## The queue

`~/.jobs/queue.md` holds the jobs waiting for a pass, one section per site, best first, after a `## Priority` section for the jobs Adam singles out, on any site:

    ## Priority
    ## Workday
    - [Adobe: 2027 University Graduate - Machine Learning Engineer](<url>): ML new grad; Python and PyTorch match
    ## Greenhouse
    ## Ashby
    ## Other sites

A pass takes the top job from each site section and deletes those lines. `## Priority` jobs run in the priority lane (`loop.md`), one at a time, followed by `## Other sites` when no Priority job can run. Reorder freely as better jobs turn up. Within each section, big tech comes first, then unicorns, top startups, and top quant firms, then the rest (`/tmp/jobs-eval/rank_queue.py` does this). Within a tier, a job Adam should *really* apply to goes first: a role that closely matches his resume, at a company he would likely want, or a posting that is new or closing soon, since early applicants get read. Jobs that fit but are on other sites go under "Other sites": passes don't apply to them yet, but Adam can see them.

Before queuing a job, check that it isn't already queued, a fixed posting in `benchmark.md`, in the tracker's `Apps` or settled in `Failed`, or in `~/.jobs/apply.log`. Some employers cap applications per candidate (Coinbase allows 3 per 6 months; Sierra allows one new-grad application), so at such a company queue only the best qualifying posting. Sierra's limit was shown on the actual form in run 20261005-082300-3; it does not state an internship cap.

## Where to look

Fastest first:

1. **SimplifyJobs' lists**, updated daily as JSON: `https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json`, and the same path in `Summer2027-Internships`. Keep entries that are `active` and `is_visible`, newest `date_posted` first. Each has `company_name`, `title`, `url`, `locations`, `category`, `degrees`, and `sponsorship`; internships also have `terms`.
2. **The ATSs' public APIs**, to read a posting's requirements and form, or to search an employer directly (below).
3. **Adam's boards**, which need his login: Jobright recommendations, ranked by match to his resume; LinkedIn job search; and Handshake. Open them as `AGENTS.md` step 1 describes. Take each job's own application URL, never LinkedIn Easy Apply.
4. **Anything else** a web search or fetch turns up.

Fetch with `.venv/bin/python`; the system Python lacks CA certificates.
- **Greenhouse:** `GET https://boards-api.greenhouse.io/v1/boards/<board>/jobs`. For one job's requirements and form questions, add `/<id>?questions=true`. Apply at `https://job-boards.greenhouse.io/<board>/jobs/<id>`, which redirects to the employer's page when it has one.
- **Ashby:** `GET https://api.ashbyhq.com/posting-api/job-board/<org>` returns each job's `jobUrl` and `descriptionPlain`.
- **Workday:** `POST https://<tenant>.<wdN>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs` with `{"searchText": "...", "limit": 20, "offset": 0, "appliedFacets": {}}`. For details, `GET` the same URL with `/jobs` replaced by a posting's `externalPath`. Apply at `https://<tenant>.<wdN>.myworkdayjobs.com/en-US/<site><externalPath>`.

- **Microsoft (Eightfold):** `GET https://apply.careers.microsoft.com/api/pcsx/position_details?domain=microsoft.com&position_id=<id>` returns `data.name`, `data.jobDescription`, `data.locations`, and `data.displayJobId`; the careers page itself mostly exposes configuration. Apply at `https://apply.careers.microsoft.com/careers/job/<id>`.

Employers that had matching postings in October 2026; add more as you find them:
- **Greenhouse boards:** robinhood, figma, coinbase, stripe, pinterest, lyft, affirm, datadog, databricks, cloudflare, samsara, point72, imc.
- **Ashby orgs:** ramp, notion, openai, cohere, replit, harvey, sierra, modal, perplexity.
- **Workday (tenant, host, site):** adobe wd5 external_experienced; nvidia wd5 NVIDIAExternalCareerSite; amat wd1 External; pnc wd5 External; capitalone wd12 Capital_One; salesforce wd12 External_Career_Site; intel wd1 External; mastercard wd1 CorporateCareers.
