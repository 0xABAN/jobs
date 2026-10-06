import io
import json
import urllib.error

import pytest

from jobs import sheets


def test_throttled_calls_are_retried_until_sheets_answers(monkeypatch):
    replies = [429, 503, {"values": [["URL"], ["https://job"]]}]
    waits = []

    def urlopen(request, timeout):
        reply = replies.pop(0)
        if isinstance(reply, int):
            raise urllib.error.HTTPError(request.full_url, reply, "busy", {}, io.BytesIO(b"{}"))
        return io.BytesIO(json.dumps(reply).encode())

    monkeypatch.setattr(sheets.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sheets, "_access_token", lambda: "token")
    monkeypatch.setattr(sheets.time, "sleep", waits.append)

    assert sheets.Sheet("id").rows("Apps") == [{"URL": "https://job"}]
    assert waits == [2, 4]


def test_other_errors_and_a_lasting_throttle_still_raise(monkeypatch):
    def urlopen(request, timeout):
        raise urllib.error.HTTPError(request.full_url, code, "no", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(sheets.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sheets, "_access_token", lambda: "token")
    monkeypatch.setattr(sheets.time, "sleep", lambda seconds: None)

    for code in (403, 429):
        with pytest.raises(urllib.error.HTTPError):
            sheets.Sheet("id").rows("Apps")


def test_a_failed_write_is_not_repeated(monkeypatch):
    calls = []

    def urlopen(request, timeout):
        calls.append(request.get_method())
        raise urllib.error.HTTPError(request.full_url, 503, "busy", {}, io.BytesIO(b"{}"))

    monkeypatch.setattr(sheets.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(sheets, "_access_token", lambda: "token")
    monkeypatch.setattr(sheets.time, "sleep", lambda seconds: None)

    with pytest.raises(urllib.error.HTTPError):
        sheets.Sheet("id")._call("POST", "/values/Apps:append", {"values": [["x"]]})
    assert calls == ["POST"]
