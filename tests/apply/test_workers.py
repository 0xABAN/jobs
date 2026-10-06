import json

import pytest

from jobs.apply import workers


def test_each_url_runs_on_one_worker_at_a_time(tmp_path, monkeypatch):
    monkeypatch.setattr(workers, "WORKERS_DIR", tmp_path)
    monkeypatch.setattr(workers, "_prepare", lambda directory: None)

    with workers.worker("https://a", 2) as first:
        with workers.worker("https://a", 2) as duplicate:
            assert duplicate is None

        with workers.worker("https://b", 2) as second:
            assert {first.name, second.name} == {"0", "1"}
            assert workers.running() == ["https://a", "https://b"]

    assert workers.running() == []

    # A finished worker's job file still names its last URL; it must not block a retry.
    with workers.worker("https://a", 1) as retry:
        assert retry is not None

    # Experiments in parallel keep separate workers, but never apply to one URL twice at once.
    with workers.worker("https://a", 2) as low, workers.worker("https://b", 2, first=2) as high:
        assert (low.name, high.name) == ("0", "2")
        with workers.worker("https://a", 2, first=2) as duplicate:
            assert duplicate is None


def test_a_run_can_wait_for_another_run_of_its_url(tmp_path, monkeypatch):
    monkeypatch.setattr(workers, "WORKERS_DIR", tmp_path)
    monkeypatch.setattr(workers, "_prepare", lambda directory: None)

    class Waited(Exception):
        pass

    def sleep(seconds):
        raise Waited

    monkeypatch.setattr(workers.time, "sleep", sleep)

    with workers.worker("https://a", 1):
        # Worker 1 is free, but worker 0 has the URL, so the claim waits instead of yielding None.
        with pytest.raises(Waited):
            with workers.worker("https://a", 1, first=1, wait_for_url=True):
                pass


def test_greenhouse_runs_at_one_employer_wait_for_each_other(tmp_path, monkeypatch):
    monkeypatch.setattr(workers, "WORKERS_DIR", tmp_path)
    monkeypatch.setattr(workers, "_prepare", lambda directory: None)

    class Waited(Exception):
        pass

    def sleep(seconds):
        raise Waited

    monkeypatch.setattr(workers.time, "sleep", sleep)

    with workers.worker("https://job-boards.greenhouse.io/tower/jobs/1", 3):
        # Another employer's Greenhouse job, and another site's job, run alongside.
        with workers.worker("https://job-boards.greenhouse.io/drweng/jobs/2", 3) as other:
            assert other is not None

        with workers.worker("https://nvidia.wd5.myworkdayjobs.com/job/3", 3) as other:
            assert other is not None

        # The same employer waits, even with a free worker, so the two never share a code email.
        with pytest.raises(Waited):
            with workers.worker("https://boards.greenhouse.io/tower/jobs/4", 3):
                pass


@pytest.mark.parametrize("url, board", [
    ("https://job-boards.greenhouse.io/stripe/jobs/8128745", "stripe"),
    ("https://job-boards.eu.greenhouse.io/imc/jobs/4907430101?gh_src=x", "imc"),
    ("https://job-boards.greenhouse.io/embed/job_app?for=waymo&token=7", "waymo"),
    ("https://app.greenhouse.io/embed/job_app?token=8044334", ""),
    ("https://jobs.ashbyhq.com/openai/55150071", None),
])
def test_greenhouse_board_comes_from_the_url(url, board):
    assert workers._greenhouse_board(url) == board


def test_a_greenhouse_url_that_hides_its_board_waits_for_any_greenhouse_run():
    hidden = "https://app.greenhouse.io/embed/job_app?token=8024128"

    assert workers._shares_codes(hidden, "https://job-boards.greenhouse.io/stripe/jobs/1")
    assert not workers._shares_codes(hidden, "https://jobs.ashbyhq.com/openai/1")
    assert not workers._shares_codes("https://job-boards.greenhouse.io/stripe/jobs/1", "")


def test_prepared_chrome_copies_never_offer_to_save_passwords(tmp_path, monkeypatch):
    profile = tmp_path / "profile"
    (profile / "Default").mkdir(parents=True)
    (profile / "Default/Preferences").write_text(json.dumps({"profile": {"name": "jobs"}}))
    monkeypatch.setattr(workers, "CHROME_PROFILE", profile)
    monkeypatch.setattr(workers, "REPO_ROOT", tmp_path)

    workers._prepare(tmp_path / "worker")

    preferences = json.loads((tmp_path / "worker/chrome/Default/Preferences").read_text())
    assert preferences == {"credentials_enable_service": False,
                           "profile": {"name": "jobs", "password_manager_enabled": False}}


def test_session_sites_run_on_their_worker_and_other_jobs_skip_it(monkeypatch):
    monkeypatch.setattr(workers, "SESSION_WORKERS", {4: ("ycombinator.com",), 5: ("jobs.apple.com",)})

    assert workers._candidates("https://www.ycombinator.com/companies/x/jobs/1", 20, 0) == [4]
    assert workers._candidates("https://jobs.apple.com/en-us/details/1", 20, 0) == [5]
    assert workers._candidates("https://job-boards.greenhouse.io/stripe/jobs/1", 8, 0) == [0, 1, 2, 3, 6, 7]
