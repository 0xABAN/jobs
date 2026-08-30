---
name: use-fantastic-jobs
description: Pull junior+ full-time SWE/ML/data jobs from the Fantastic.jobs ATS API for Adam's target US cities and company set. Use when discovering jobs, polling Fantastic.jobs, listing new postings, or the user mentions FANTASTIC_JOBS / active-ats.
compatibility: pi codex
---

# Fantastic.jobs discovery

REST only. No official MCP. Keyword search, not semantic. No wrapper scripts.

## Mandatory preflight

Before making any API request, read all of the following:

- `/Users/adam/dev/jobs/AGENTS.md`
- this skill file
- `/Users/adam/.codex/automations/fantastic-jobs-application-brief-8am-et/memory.md` when present
- `/Users/adam/dev/jobs/src/core/orgs.txt`
- `/Users/adam/dev/jobs/src/resume/Adam_Torres_Encarnacion_Resume.pdf`
- `/Users/adam/dev/jobs/src/resume/Adam_Torres_Encarnacion_Resume.tex`

Do not read credential-bearing MCP files. Treat the automation memory as run context, not as a substitute for the current API pull.

Key: `FANTASTIC_JOBS_API_KEY` in `$HOME/dev/jobs/.env`. Never print it.

Docs: https://developer.fantastic.jobs/documentation/how-fantastic-jobs-api-works.md
OpenAPI: https://data.fantastic.jobs/openapi

## Default pull

`GET https://data.fantastic.jobs/v1/active-ats`

Source the key from `.env`. Write response bodies to `/tmp`, not this repo. Do not print or log the key, full authorization header, or credential-bearing command. Do not paginate.

```
Authorization: Bearer $FANTASTIC_JOBS_API_KEY
time_frame=7d          # 24h is often empty on this filter set
limit=25
title_advanced=('software engineer' | 'machine learning engineer' | 'ai engineer' | 'data scientist' | 'data engineer') & !(manager | director | staff | principal | lead | intern | senior)
location="San Francisco, California, United States" OR "Oakland, California, United States" OR "Berkeley, California, United States" OR "Palo Alto, California, United States" OR "Mountain View, California, United States" OR "Sunnyvale, California, United States" OR "Santa Clara, California, United States" OR "San Jose, California, United States" OR "Cupertino, California, United States" OR "Menlo Park, California, United States" OR "Redwood City, California, United States" OR "San Mateo, California, United States" OR "Fremont, California, United States" OR "New York, New York, United States" OR "Manhattan, New York, United States" OR "Seattle, Washington, United States" OR "Bellevue, Washington, United States" OR "Redmond, Washington, United States" OR "Boston, Massachusetts, United States" OR "Cambridge, Massachusetts, United States" OR "Los Angeles, California, United States" OR "Santa Monica, California, United States" OR "Culver City, California, United States" OR "El Segundo, California, United States" OR "Irvine, California, United States" OR "San Diego, California, United States" OR "Miami, Florida, United States" OR "Austin, Texas, United States" OR "Dallas, Texas, United States" OR "Houston, Texas, United States"
ai_employment_type=FULL_TIME
ai_experience_level=0-2,2-5
organization_agency=exclude
exclude_organization=Speechify
organization_advanced=<from src/core/orgs.txt; preserve each line as one complete organization record, represent each record as a single-quoted phrase, join records with `|` (never the word `OR`), URL-encode the parameter, and keep each encoded request under 10k chars>
```

The `OR` word is valid for the location parameter shown above, but it is not valid inside `organization_advanced`. Advanced-search Boolean OR is `|`. The official advanced-search guide documents single-quoted phrases as the exact phrase form (for example, `'Applied Intuition'`), equivalent to explicit `<->` operators. Do not mechanically replace spaces or hyphens inside an organization name: that can alter the source record or create invalid syntax. Escape any single quote in a record according to the API's documented phrase escaping rules, and fail closed if a record cannot be represented safely. A malformed organization expression produces HTTP 400.

## Allowlist batching and validation

Read the allowlist line-by-line with whitespace preservation. Never use whitespace-delimited `xargs`, shell word splitting, or positional arguments that can split names such as `Applied Intuition`. Convert each non-empty line to one single-quoted phrase without changing its spelling, then join the phrases with `|`. Use bounded batches of about 200 complete organization records; the proven full scan covers 2,013 organizations in 11 requests with `limit=50` and stays well below the 10,000-character limit. Recalculate the URL-encoded request length rather than assuming the batch size is safe. Before the full run, locally validate that every batch expression has balanced grouping/quotes, explicit operators between records, and no bare `OR` token.

For every batch:

1. Save the response body under `/tmp`.
2. Fail closed on non-2xx responses, invalid JSON, or a response that is not an array.
3. Record batch number, organization count, and returned-job count in a temporary manifest.
4. Merge all valid arrays and deduplicate by the Fantastic.jobs integer `id`.
5. Verify that every non-empty allowlist line was assigned to exactly one batch before ranking.

Never treat a partial batch run as a complete organization scan. Never report a total from a subset of successful batches as the full API total.

The API `limit` is a per-request result cap, not an API-request quota. Keep the number of requests low by batching organizations; do not issue one request per organization.

## Salary screening

Use $130,000 as the disclosed-salary upper-bound threshold. Remove a role only when its confidently disclosed salary range has a maximum below $130,000. A range qualifies when its maximum reaches at least $130,000. Keep roles with unlisted or ambiguous salary eligible for alignment review and report them as `Salary: not listed`; never estimate compensation.

`title` is Google-style. A trailing `-Manager` after `OR` phrases only binds to the last clause. Use `title_advanced` for grouped exclusions.

Location needs full names (`United States`, not `US`). Quoted `"City, State, United States"`. Phoenix can leak; ignore it.

## Company set

`src/core/orgs.txt`: Nasdaq-100 tech + Cloud 100 + VGT extras + magnets/aliases + Crunchbase unicorns.

Feed is newest-first. Google/Apple will dominate a 25-row page. `exclude_organization=Google,Apple` if the user wants the tail.
