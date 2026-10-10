import json
import urllib.error

import pytest

from jobs import cli


def test_clean_mail_reports_a_network_failure_in_one_line(monkeypatch, capsys):
    def offline(*args, **kwargs):
        raise urllib.error.URLError("nodename nor servname provided, or not known")

    monkeypatch.setattr(cli, "clean_confirmations", offline)
    monkeypatch.setattr(cli, "load_profile", lambda: {"tracker": {"sheet_id": "sheet"}})
    monkeypatch.setattr(cli.sys, "argv", ["jobs", "clean-mail"])

    with pytest.raises(SystemExit) as exit:
        cli.main()

    assert exit.value.code == 1
    (line,) = capsys.readouterr().err.splitlines()
    assert json.loads(line)["mail_cleanup"] == "error"
