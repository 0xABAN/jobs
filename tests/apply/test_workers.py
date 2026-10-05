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
