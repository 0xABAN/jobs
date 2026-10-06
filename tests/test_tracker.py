from jobs import tracker as tracker_module
from jobs.apply.result import Result
from jobs.sheets import Sheet
from jobs.tracker import Tracker


def test_skips_applied_jobs_and_settled_failures(monkeypatch):
    tabs = {
        "Apps": [["jobs", "URL"], ["Acme", "https://applied"]],
        "Failed": [["URL", "Reason"], ["https://settled", "not_eligible"], ["https://retryable", "timeout"]],
    }
    monkeypatch.setattr(Sheet, "_call", lambda self, method, path, body=None: {"values": tabs[path.split("/")[-1]]})
    tracker = Tracker("sheet")

    assert tracker.skip_reason("https://applied") == "already_applied"
    assert tracker.skip_reason("https://settled") == "not_eligible"
    assert tracker.skip_reason("https://retryable") is None
    assert tracker.skip_reason("https://new") is None


def test_finds_earlier_applications_to_the_employer_in_its_url(monkeypatch):
    apps = [["jobs", "Role", "Applied", "URL"],
            ["IMC", "Graduate Software Engineer", "2026-09-07", ""],
            ["Akuna Capital", "Junior Quant Researcher", "2026-10-04", ""],
            ["X", "Engineer", "2026-10-01", ""]]
    monkeypatch.setattr(Sheet, "_call", lambda self, method, path, body=None: {"values": apps})
    tracker = Tracker("sheet")

    assert [row["Role"] for row in tracker.earlier_applications("https://job-boards.eu.greenhouse.io/imc/jobs/4842595101")] == [
        "Graduate Software Engineer"]
    assert [row["jobs"] for row in tracker.earlier_applications("https://job-boards.greenhouse.io/akunacapital/jobs/1")] == [
        "Akuna Capital"]
    # Two-letter names would match unrelated URLs, such as every Workday URL's XMLNAME.
    assert tracker.earlier_applications("https://acme.wd5.myworkdayjobs.com/job/XMLNAME-2027") == []


def test_finds_earlier_applications_through_the_same_application_site(monkeypatch):
    apps = [["jobs", "Role", "Applied", "URL"],
            ["Hudson River Trading", "Data Scientist Intern", "2026-10-05",
             "https://job-boards.greenhouse.io/wehrtyou/jobs/8257369"],
            ["Stripe", "Software Engineer, Intern", "2026-10-05", "https://job-boards.greenhouse.io/stripe/jobs/8128745"],
            ["Notion", "Software Engineer", "2026-10-01", "https://jobs.ashbyhq.com/notion/1"],
            ["Hidden", "Engineer", "2026-10-01", "https://app.greenhouse.io/embed/job_app?token=1"]]
    monkeypatch.setattr(Sheet, "_call", lambda self, method, path, body=None: {"values": apps})
    tracker = Tracker("sheet")

    # The board "wehrtyou" does not name Hudson River Trading, but the earlier row went through it.
    assert [row["Role"] for row in tracker.earlier_applications("https://boards.greenhouse.io/wehrtyou/jobs/1")] == [
        "Data Scientist Intern"]
    # A URL that hides its board matches no one through the site alone, nor does a host many employers share.
    assert tracker.earlier_applications("https://app.greenhouse.io/embed/job_app?token=2") == []
    assert tracker_module._site("https://jobs.smartrecruiters.com/ServiceNow/1") is None


def test_records_company_under_the_apps_header(monkeypatch, tmp_path):
    writes = []

    def call(self, method, path, body=None):
        if method == "POST":
            writes.append((path, body))
            return {}
        if path == "/values/Failed":
            return {"values": [["URL", "Reason"]]}
        assert path == "/values/Apps%211%3A1"
        return {"values": [["jobs", "Role", "Applied", "Salary", "fantastic.jobs Id", "URL"]]}

    monkeypatch.setattr(tracker_module, "STATE_DIR", tmp_path)
    monkeypatch.setattr(Sheet, "_call", call)
    result = Result("applied", None, "Receipt confirmed", "Acme", "Engineer", "$100,000", None)

    Tracker("sheet").record("https://job", result, "run-1")

    today = tracker_module.date.today().isoformat()
    assert writes == [("/values/Apps:append?valueInputOption=RAW", {
        "values": [["Acme", "Engineer", today, "$100,000", "", "https://job"]],
    })]


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
