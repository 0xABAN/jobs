from jobs import tracker as tracker_module
from jobs.sheets import Sheet
from jobs.tracker import Tracker


def test_skips_applied_jobs_and_settled_failures(monkeypatch):
    tabs = {
        "Apps": [["Company", "URL"], ["Acme", "https://applied"]],
        "Failed": [["URL", "Reason"], ["https://settled", "not_eligible"], ["https://retryable", "timeout"]],
    }
    monkeypatch.setattr(Sheet, "_call", lambda self, method, path, body=None: {"values": tabs[path.split("/")[-1]]})
    tracker = Tracker("sheet")

    assert tracker.skip_reason("https://applied") == "already_applied"
    assert tracker.skip_reason("https://settled") == "not_eligible"
    assert tracker.skip_reason("https://retryable") is None
    assert tracker.skip_reason("https://new") is None


def test_lists_each_account_site_once(monkeypatch, tmp_path):
    rows = [{"Site": "old.wd5.myworkdayjobs.com", "Email": "a@x.com", "First used": "2026-01-01", "Last used": "2026-01-01"}]

    class FakeSheet:
        def find(self, tab, column, value):
            return next(((i + 2, row) for i, row in enumerate(rows) if row[column] == value), (None, {}))

        def append(self, tab, row):
            rows.append(row)

        def update(self, tab, number, row):
            rows[number - 2] = row

    monkeypatch.setattr(tracker_module, "STATE_DIR", tmp_path)
    tracker = Tracker("sheet")
    tracker.sheet = FakeSheet()
    today = tracker_module.date.today().isoformat()

    tracker.record_account("old.wd5.myworkdayjobs.com", "a@x.com")
    tracker.record_account("new.wd1.myworkdayjobs.com", "a@x.com")

    assert rows == [
        {"Site": "old.wd5.myworkdayjobs.com", "Email": "a@x.com", "First used": "2026-01-01", "Last used": today},
        {"Site": "new.wd1.myworkdayjobs.com", "Email": "a@x.com", "First used": today, "Last used": today},
    ]
