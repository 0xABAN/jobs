import json
import os
import time
from contextlib import contextmanager

from jobs.apply import launcher
from jobs.apply.result import Result


def fake_run(monkeypatch, tmp_path, agent_result: str) -> list:
    """Make ``apply`` run without Chrome, Pi, or the Sheet; return the list the fake tracker records into."""
    recorded = []

    class Tracker:
        def __init__(self, sheet_id):
            pass

        def skip_reason(self, url):
            return None

        def earlier_applications(self, url):
            return []

        def record(self, url, result, run_id):
            recorded.append(result)

        def record_account(self, site, email):
            recorded.append((site, email))

    @contextmanager
    def worker(url, count, first, wait_for_url):
        yield tmp_path / "0"

    @contextmanager
    def chrome(profile, url):
        yield 4242

    profile = {"personal": {"email": "adam@example.com", "email_by_employer": {"NVIDIA": "adam@school.edu"}},
               "tracker": {"sheet_id": "S"}}
    monkeypatch.setattr(launcher, "load_profile", lambda: profile)
    monkeypatch.setattr(launcher, "Tracker", Tracker)
    monkeypatch.setattr(launcher, "worker", worker)
    monkeypatch.setattr(launcher, "chrome", chrome)
    monkeypatch.setattr(launcher, "devtools_port", lambda profile: 9333)
    monkeypatch.setattr(launcher, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(launcher.pi, "run", lambda prompt, **options: f"```json\n{agent_result}\n```")
    return recorded


def test_apply_records_and_returns_the_agents_result(monkeypatch, tmp_path):
    recorded = fake_run(monkeypatch, tmp_path, '{"status": "applied", "reason": null, "explanation": "Submitted."}')

    result = launcher.apply("https://example.com/job", dry_run=False, timeout_minutes=1, workers=1)

    assert result == Result("applied", None, "Submitted.")
    assert recorded == [result]

    (run_dir,) = (tmp_path / "runs").iterdir()
    phases = json.loads((run_dir / "result.json").read_text())["phases"]
    assert list(phases) == ["worker", "check", "chrome", "agent", "quit", "record"]


def test_dry_runs_record_only_the_account_they_used(monkeypatch, tmp_path):
    recorded = fake_run(monkeypatch, tmp_path, '{"status": "dry_run", "reason": null, "explanation": "Filled.",'
                                               ' "account": "acme.wd5.myworkdayjobs.com"}')

    launcher.apply("https://example.com/job", dry_run=True, timeout_minutes=1, workers=1)

    assert recorded == [("acme.wd5.myworkdayjobs.com", "adam@example.com")]


def test_records_an_account_under_the_employers_own_email(monkeypatch, tmp_path):
    recorded = fake_run(monkeypatch, tmp_path, '{"status": "dry_run", "reason": null, "explanation": "Filled.",'
                                               ' "company": "NVIDIA", "account": "nvidia.wd5.myworkdayjobs.com"}')

    launcher.apply("https://example.com/job", dry_run=True, timeout_minutes=1, workers=1)

    assert recorded == [("nvidia.wd5.myworkdayjobs.com", "adam@school.edu")]


def test_prunes_all_but_results_from_runs_older_than_three_hours(monkeypatch, tmp_path):
    monkeypatch.setattr(launcher, "RUNS_DIR", tmp_path)
    for run in ("old", "recent"):
        for name in ("prompt.md", "transcript.jsonl", "stderr.log", "result.json"):
            (tmp_path / run).mkdir(exist_ok=True)
            (tmp_path / run / name).write_text("x")

    four_hours_ago = time.time() - 4 * 3600
    for log in (tmp_path / "old").iterdir():
        os.utime(log, (four_hours_ago, four_hours_ago))

    launcher.prune_logs()

    assert [log.name for log in (tmp_path / "old").iterdir()] == ["result.json"]
    assert len(list((tmp_path / "recent").iterdir())) == 4


def test_skips_banned_sites_without_claiming_a_worker(monkeypatch):
    monkeypatch.setattr(launcher, "worker", None)  # calling it would fail

    result = launcher.apply("https://jobs.lever.co/acme/123", dry_run=False, timeout_minutes=1, workers=1)

    assert (result.status, result.reason) == ("skipped", "banned_site")
