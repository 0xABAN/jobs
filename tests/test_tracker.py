from jobs.tracker import Tracker


def test_skips_applied_jobs_and_settled_failures(monkeypatch):
    tabs = {
        "Apps": [["Company", "URL"], ["Acme", "https://applied"]],
        "Failed": [["URL", "Reason"], ["https://settled", "not_eligible"], ["https://retryable", "timeout"]],
    }
    monkeypatch.setattr(Tracker, "_call", lambda self, method, path, body=None: {"values": tabs[path.split("/")[-1]]})
    tracker = Tracker("sheet")

    assert tracker.skip_reason("https://applied") == "already_applied"
    assert tracker.skip_reason("https://settled") == "not_eligible"
    assert tracker.skip_reason("https://retryable") is None
    assert tracker.skip_reason("https://new") is None
