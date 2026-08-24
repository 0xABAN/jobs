---
name: use-fantastic-jobs
description: Pull junior+ full-time SWE/ML/data jobs from the Fantastic.jobs ATS API for Adam's target US cities and company set. Use when discovering jobs, polling Fantastic.jobs, listing new postings, or the user mentions FANTASTIC_JOBS / active-ats.
compatibility: pi codex
---

# Fantastic.jobs discovery

REST only. No official MCP. Keyword search, not semantic. No wrapper scripts.

Key: `FANTASTIC_JOBS_API_KEY` in `$HOME/dev/jobs/.env`. Never print it.

Docs: https://developer.fantastic.jobs/documentation/how-fantastic-jobs-api-works.md
OpenAPI: https://data.fantastic.jobs/openapi

## Default pull

`GET https://data.fantastic.jobs/v1/active-ats`

Source the key from `.env`. Write the body to `/tmp`, not this repo. Print a table + `x-api-*` headers. Do not paginate unless asked.

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
organization_advanced=<join src/prompts/orgs.txt with " | "; single-quote names that contain space or ->
```

Each returned job burns 1 Jobs credit. Each call burns 1 API Request.

`title` is Google-style. A trailing `-Manager` after `OR` phrases only binds to the last clause. Use `title_advanced` for grouped exclusions.

Location needs full names (`United States`, not `US`). Quoted `"City, State, United States"`. Phoenix can leak; ignore it.

## Credits

Trial was 500 jobs / 50 requests. Headers after each call:

- `x-api-jobs-this-request` / `x-api-jobs-remaining` / `x-api-jobs-limit`
- `x-api-requests-remaining` / `x-api-requests-limit`

`remaining` headers can lag a few seconds. Trust `x-api-jobs-this-request`.

## Company set

`src/prompts/orgs.txt`: Nasdaq-100 tech + Cloud 100 names + VGT extras + magnets/aliases (Uber, LinkedIn, GitHub, trading firms, labs, defense/robots). Not Fortune 500. Not the full unicorn dump (too big for one request; 10k char cap).

Feed is newest-first. Google/Apple will dominate a 25-row page. `exclude_organization=Google,Apple` if the user wants the tail.

## Out of scope

Fill / apply / Jobright / ApplyPilot / sheets. Discovery only.
