import json
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

        def record(self, url, result, run_id):
            recorded.append(result)

        def record_account(self, site, email):
            recorded.append((site, email))

    @contextmanager
    def worker(url, count):
        yield tmp_path / "0"

    @contextmanager
    def chrome(profile, url):
        yield 4242

    profile = {"personal": {"email": "adam@example.com"}, "tracker": {"sheet_id": "S"}}
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


def test_skips_banned_sites_without_claiming_a_worker(monkeypatch):
    monkeypatch.setattr(launcher, "worker", None)  # calling it would fail

    result = launcher.apply("https://jobs.lever.co/acme/123", dry_run=False, timeout_minutes=1, workers=1)

    assert (result.status, result.reason) == ("skipped", "banned_site")
