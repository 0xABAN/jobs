from jobs import chrome as chrome_module


def test_a_run_drops_its_caches_but_keeps_logins(tmp_path, monkeypatch):
    for kept_or_dropped in ("Default/Cache/data", "Default/Code Cache/js", "GrShaderCache/x", "Default/Cookies",
                            "Default/IndexedDB/site"):
        (tmp_path / kept_or_dropped).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / kept_or_dropped).write_text("x")

    monkeypatch.setattr(chrome_module, "launch", lambda profile, url: 123)
    monkeypatch.setattr(chrome_module, "close", lambda pid: None)
    monkeypatch.setattr(chrome_module, "_alive", lambda pid: False)

    with chrome_module.chrome(tmp_path, "https://job"):
        pass

    assert not (tmp_path / "Default/Cache").exists()
    assert not (tmp_path / "Default/Code Cache").exists()
    assert not (tmp_path / "GrShaderCache").exists()
    assert (tmp_path / "Default/Cookies").exists()
    assert (tmp_path / "Default/IndexedDB/site").exists()


def test_caches_stay_while_chrome_is_still_running(tmp_path, monkeypatch):
    (tmp_path / "Default/Cache").mkdir(parents=True)
    monkeypatch.setattr(chrome_module, "launch", lambda profile, url: 123)
    monkeypatch.setattr(chrome_module, "close", lambda pid: None)
    monkeypatch.setattr(chrome_module, "_alive", lambda pid: True)

    with chrome_module.chrome(tmp_path, "https://job"):
        pass

    assert (tmp_path / "Default/Cache").exists()
