from contextlib import contextmanager

from jobs.apply import launcher
from jobs.apply.result import Result


def test_apply_records_and_returns_the_agents_result(monkeypatch, tmp_path):
    recorded = []

    class Tracker:
        def __init__(self, sheet_id):
            pass

        def skip_reason(self, url):
            return None

        def record(self, url, result, run_id):
            recorded.append(result)

    @contextmanager
    def worker(url, count):
        yield tmp_path / "0"

    @contextmanager
    def chrome(profile, url):
        yield 4242

    final_message = '```json\n{"status": "applied", "reason": null, "explanation": "Submitted."}\n```'
    monkeypatch.setattr(launcher, "load_profile", lambda: {"tracker": {"sheet_id": "S"}})
    monkeypatch.setattr(launcher, "Tracker", Tracker)
    monkeypatch.setattr(launcher, "worker", worker)
    monkeypatch.setattr(launcher, "chrome", chrome)
    monkeypatch.setattr(launcher, "devtools_port", lambda profile: 9333)
    monkeypatch.setattr(launcher, "RUNS_DIR", tmp_path / "runs")
    monkeypatch.setattr(launcher.pi, "run", lambda prompt, **options: final_message)

    result = launcher.apply("https://example.com/job", dry_run=False, timeout_minutes=1, workers=1)

    assert result == Result("applied", None, "Submitted.")
    assert recorded == [result]
