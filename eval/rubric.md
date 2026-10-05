# Grading a run

The agent's `status` is its own claim; the grade checks it. Grade every run within 3 hours of its end, before its transcript is deleted.

## What to read

Read the run's `result.json`, `profile.json`, and the agent's narration, typing, last screenshots, and last page reads. This prints the narration and everything the agent typed, saves the last 4 screenshots, and saves the text of the agent's last 8 codemode results, which hold its page reads:

    python3 - <run id> <<'EOF'
    import base64, json, sys
    from pathlib import Path

    run = Path.home() / ".jobs/runs" / sys.argv[1]
    turn, screenshots, reads = 0, [], []

    # Agents type the account password at sign-in; never print it.
    password = json.loads((Path.home() / "dev/jobs/profile.json").read_text())["personal"]["password"]
    redact = lambda text: text.replace(password, "[password]") if password else text

    for line in (run / "transcript.jsonl").read_text().split("\n"):
        if not line.strip():
            continue
        event = json.loads(line)
        if event["type"] == "message_end" and event["message"]["role"] == "assistant":
            turn += 1
            text = " ".join(b["text"] for b in event["message"]["content"] if b["type"] == "text").strip()
            if text:
                print(f"[{turn} @{event['t']:.0f}s] {redact(text)}")
        elif event["type"] == "tool_execution_start" and event["toolName"].endswith("browser_type"):
            print(f"    typed @{event['t']:.0f}s: {redact(event['args'].get('text', ''))}")
        elif event["type"] == "tool_execution_end":
            content = event["result"].get("content", [])
            screenshots += [b["data"] for b in content if b["type"] == "image"]
            if event["toolName"] == "codemode":
                reads.append(f"--- @{event['t']:.0f}s\n" + "\n".join(b["text"] for b in content if b["type"] == "text"))

    for n, data in enumerate(screenshots[-4:]):
        path = Path(f"/tmp/grade-{run.name}-{n}.png")
        path.write_bytes(base64.b64decode(data))
        print(path)

    path = Path(f"/tmp/grade-{run.name}-reads.txt")
    path.write_text(redact("\n".join(reads[-8:])))
    print(path)
    EOF

Open the screenshots with the read tool and search the reads. Use what the agent saw before Submit, or before it stopped in a dry run: Workday's Review page and a filled Greenhouse or Ashby form show every answer. Screenshots cover only the visible part of a page, so check the rest in the reads; for anything still missing, search the transcript.

## Correct

A run is correct when its outcome is right and it has no critical error.

- **Live run:** the right outcome is `applied`. A failure is also right when the agent could not have done better: `expired` (the posting closed), `sso_required`, `email_only`, `sensitive_request`, `unsafe_permissions`, or `missing_fact` for a fact the profile really lacks. List a missing fact under "Needs Adam" in `ideas.md`.
- **Fixed run:** the outcome `benchmark.md` expects.
- `not_eligible` is right only when the posting states a hard requirement Adam misses, per the prompt's Eligibility section.
- Wrong outcomes include `timeout`, `browser_unavailable`, a `login_issue` on an account that works, and giving up on a CAPTCHA the solver handles.

## Critical errors

Any one makes the run incorrect. On a live run, the error was sent to the employer.

- A hard fact differs from the profile or resume: name fields, email, phone, address, citizenship, work authorization, sponsorship, school, degree, graduation dates, GPA, age, or criminal history.
- A voluntary self-identification answer differs from `eeo_voluntary`.
- No resume attached, or a different resume than the prompt's rules choose.
- An invented fact: anything presented as Adam's that neither the profile nor the resume supports, beyond the assumptions the prompt allows.
- Clicked Submit in a dry run, or submitted for a job that is ineligible, at an excluded company, or not the posting it was given.

## Minor errors

These are counted, but the run can still be correct.

- An optional field filled when the prompt says to leave it empty, or left empty when the profile answers it.
- A wrong `company`, `role`, or `account` in the result, or a missing `salary` when the posting states one.

## Recording

Add a `grade` to the run's `result.json`:

    "grade": {"kind": "workday", "correct": true, "critical": [], "minor": ["pronouns filled"], "note": "anything surprising, in one line"}

`kind` is `workday`, `greenhouse`, `ashby`, or `other` (any other site, which counts toward accuracy but not experiment time) for a live run, named for the form's ATS even when it sits inside an employer's own page; for a fixed run, it is its `benchmark.md` id. When a failure outside the harness hampered the run, such as a locked screen or a site outage, add `"infra": "<what happened>"`: the run then counts toward neither accuracy nor time, and a live job it failed goes back in the queue. Whatever is worth trying next goes into `ideas.md` with the run id.
