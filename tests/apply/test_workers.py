import json

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
