# Eval loop

You are improving Adam's apply harness while it applies him to jobs. Every pass submits real applications and repeats a few fixed dry runs. Each change is a hypothesis: keep it when the passes show runs got faster or more accurate, revert it otherwise. Git is the lab notebook. You are the orchestrator of `AGENTS.md`; read it and `sourcing.md` first.

This runs as a goal that only Adam ends, so there is no finish line: after every verdict, start the next pass. Never ask Adam anything and never sit idle. When `ideas.md` runs dry, measure a fresh baseline and mine its logs for more.

## What stays fixed

- Apply agents run `pi.MODEL` (Opus 5.5, low thinking) with the default 60-minute timeout, on 3 workers per lane.
- `benchmark.md` and `rubric.md` change only in commits of their own, never in an experiment's, and never to make a result pass.
- Experiments never weaken the prompt's safety rules: hard stops, eligibility, never inventing facts, banned sites, never asking Adam.
- Rules stay general. A note may describe an ATS (Workday, Greenhouse, Ashby), never a single employer or posting.
- While a lane's pass runs, leave its checkout alone, and `profile.json` while any pass runs: each run reads them when it starts, so an edit would split the pass between two versions. Files in the main checkout's `eval/` are safe to edit anytime.

## Lanes

Two experiments run at once, each in a lane: a git worktree of its own with 3 of the 6 workers.

| Lane | Checkout | Workers | Flag |
|---|---|---|---|
| a | `~/.jobs/lanes/a` | 0–2 | `--first-worker 0` |
| b | `~/.jobs/lanes/b` | 3–5 | `--first-worker 3` |

Make an experiment's change in its lane and run its passes from there. The main checkout, `~/dev/jobs`, only receives records. A lane with no experiment ready measures a baseline of `main`. Each lane links `profile.json`, `.env`, `.mcp`, and `.pi/mcp.json` to the main checkout's; recreate a lost one with `git worktree add --detach ~/.jobs/lanes/<lane> main` and those links.

To record a verdict, carry the lane's change to the main checkout: `git -C ~/.jobs/lanes/<lane> diff > /tmp/lane.diff` (after `git add -N` for any new file), then `git apply -3 /tmp/lane.diff` in `~/dev/jobs`, and commit as below. Then restart the lane from `main`: `git -C ~/.jobs/lanes/<lane> checkout -- .` and `git -C ~/.jobs/lanes/<lane> checkout --detach main`. When the other lane's change reached `main` first, keep both; if the patch conflicts, resolve it by hand, and say in the record that the change was measured without the other one.

Six workers take most of the Mac's memory. If `memory_pressure` reports less than 15% free, run one lane until it recovers.

## One pass (about 25 minutes)

1. Take the top Workday, Greenhouse, and Ashby jobs from the queue (`sourcing.md`). If a section is empty, take the next job from another and note it in the record.
2. From the lane's checkout, launch the live applications, Workday first because it takes about 25 minutes, and 30 seconds later the fixed dry runs, so the live runs claim the lane's 3 workers first:

       nohup uv run jobs apply --first-worker <0 or 3> <workday> <greenhouse> <ashby> >> ~/.jobs/apply.log 2>&1 &
       nohup uv run jobs apply --dry-run --first-worker <0 or 3> <references> <controls> >> ~/.jobs/eval.log 2>&1 &

   A URL runs on one worker at a time across both lanes, so a fixed run waits while the other lane's run of the same posting finishes.

3. While it runs, source jobs (`sourcing.md`); never just wait. Every few minutes, check `uv run jobs status`, grade each run that has finished (`rubric.md`; transcripts are deleted 3 hours after a run), and turn what its log shows into `ideas.md` entries. `uv run jobs timeline <run id>` shows where a run's time went.

## The cycle

1. **Baseline.** Measure 2 passes of `main` and record them when there is no baseline yet, the benchmark changed, the latest baseline is over a day old, 3 experiments in a row were reverted, or `main` holds kept changes that were never measured together.
2. **Hypothesis.** Take the `ideas.md` entry with the best expected gain for its effort. It must rest on evidence: a run id and what happened in it.
3. **Change.** Make exactly one change in a free lane, mark its entry **(running in lane a)** or **(running in lane b)**, and run `uv run pytest -q` there. The two lanes run different ideas.
4. **Measure.** Run 2 passes. A change aimed at one ATS needs at least 4 runs there, counting its reference; add passes until it has them.
5. **Decide** by the rule below, then **record** the verdict.

## Decision rule

The baseline is the set of runs listed by the latest commit whose verdict is `kept` or `baseline`.

- **Revert at once** when the change causes a critical error (`rubric.md`), even mid-pass: this is the one exception to leaving `src/` alone, since every run that starts later would repeat the error. The faulty application was sent, so list it under "Needs Adam" in `ideas.md`.
- **Keep** when accuracy is no worse and runs are faster beyond noise: the references at least 10% faster, or one ATS's median live run at least 15% faster, with no other ATS or reference slower by as much.
- **Keep** when accuracy is better, meaning a kind of error or failure seen in the baseline no longer occurs, and time is no worse beyond those margins.
- **Otherwise revert.** Use the verdict `inconclusive` when the numbers moved within noise, so the idea can return with more passes.

Accuracy is no worse when the change adds no incorrect runs. A failure whose cause lies outside the change, such as a posting that closed mid-run or a site outage, doesn't count against it, but the record must show the evidence.

## Numbers

A run's time is the sum of the `phases` in its `result.json` minus `worker`, the wait for a free worker. A run id ends in its worker's number, so it tells the lane. To summarize one lane's graded runs by kind:

    python3 - <first run id> <last run id> <a or b> <<'EOF'
    import json, statistics, sys
    from collections import defaultdict
    from pathlib import Path

    first, last, lane = sys.argv[1:]
    minutes, correct = defaultdict(list), defaultdict(list)

    for path in sorted(Path.home().glob(".jobs/runs/*/result.json")):
        worker = int(path.parent.name.rsplit("-", 1)[1])
        if first <= path.parent.name <= last and "ab"[worker // 3] == lane:
            run = json.loads(path.read_text())
            kind = run["grade"]["kind"]
            minutes[kind].append((sum(run["phases"].values()) - run["phases"]["worker"]) / 60)
            correct[kind].append(run["grade"]["correct"])

    for kind in sorted(minutes):
        print(f"{kind:<20} {len(minutes[kind])} runs  median {statistics.median(minutes[kind]):5.1f} min  "
              f"correct {sum(correct[kind])}/{len(correct[kind])}")
    EOF

## Record

Every experiment becomes a commit, kept or not, in the repo's Angular format, with a body like:

    perf(prompt): read a page once per wait instead of polling

    <the change and why, in a sentence or two>

    Hypothesis: get_browser_state took 177 s of a 358 s run, mostly rereads while a page loaded.
    Baseline: 1a2b3c4: Workday 24.8 min, Greenhouse 6.1, Ashby 4.2; references 5.5 and 3.9; correct 13/14
    Result: Workday 21.0 min (-15%), Greenhouse 6.0, Ashby 4.1; references 5.2 and 3.8; correct 14/14
    Runs: 20261005-091200-0..20261005-101500-2, lane a
    Verdict: kept

After a rejected or inconclusive experiment, run `git revert --no-commit <sha>` and commit `revert: <its subject>` with a line on why. A baseline is an empty commit, `git commit --allow-empty`, titled `chore(eval): measure the baseline`, with `Result`, `Runs`, and `Verdict: baseline`. Find the current one with `git log -1 -E --grep='^Verdict: (kept|baseline)'`. Never push.

## When something breaks

An infrastructure failure, such as a Claude usage limit, cua-driver, an expired Google token, or an empty CapSolver balance, is not an experiment result. If only Adam can fix it, list it under "Needs Adam". Retry every 10 minutes, and keep grading, sourcing, and mining logs meanwhile. A harness bug that blocks measuring gets its own `fix:` commit, followed by a new baseline.

## After a context reset

Rebuild the state from:
- `git log`: the records and the current baseline.
- `git worktree list` and each lane's `git diff`: a lane's uncommitted change is its running experiment, marked in `ideas.md`.
- `uv run jobs status`, `~/.jobs/apply.log`, `~/.jobs/eval.log`, and the queue, `~/.jobs/queue.md`.
- The grades in `~/.jobs/runs/*/result.json`.
