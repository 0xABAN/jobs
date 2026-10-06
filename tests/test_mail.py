import pytest

from jobs.mail import Message, classify, company_pattern

NOW = 1_800_000_000.0
COMPANIES = {company_pattern(name) for name in ("Neuralink", "The D. E. Shaw Group", "Ema", "NVIDIA", "Tower Research Capital")}


def message(sender, subject, body="", minutes_old=120, labels=()):
    return Message("id", sender, subject, body, NOW - minutes_old * 60, list(labels))


@pytest.mark.parametrize("mail, reason", [
    (message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink",
             "Your application has been received and we will review it right away."), "receipt"),
    (message("Greenhouse <no-reply@us.greenhouse-mail.io>", "Security code for your application to Tower Research Capital",
             "Copy and paste this code into the security code field on your application."), "code"),
    (message("noreply@deshaw.com", "Your application to the D. E. Shaw group",
             "Your application has been successfully submitted."), "receipt"),
    (message("NVIDIA HR <nvidia@myworkday.com>", "Thank you for your interest in NVIDIA",
             "We want to confirm that your application for the JR2023492 role has been received."), "receipt"),
])
def test_finished_runs_receipts_and_codes_are_trashed(mail, reason):
    assert classify(mail, COMPANIES, NOW, grace_minutes=60) == reason


@pytest.mark.parametrize("mail", [
    # A rejection, whatever its subject.
    message("NVIDIA HR <nvidia@myworkday.com>", "Thank you from NVIDIA",
            "Thank you for your interest. We have decided not to move forward with your application."),
    message("no-reply-recruiting@spacex.com", "Thank you for applying to Neuralink",
            "Thank you for applying. We will not be moving forward with your application at this time."),
    # An assessment invitation that looks like a receipt.
    message("no-reply@ashbyhq.com", "Neuralink | Confirmation on your Application + CodeSignal",
            "Thanks for applying! Please complete the CodeSignal assessment."),
    # A code a running agent may still need.
    message("no-reply@us.greenhouse-mail.io", "Security code for your application to Neuralink", minutes_old=10),
    # A recruiter's reply, starred mail, and a person writing.
    message("no-reply@us.greenhouse-mail.io", "Re: Thank you for applying to Neuralink", "Your application was received."),
    message("no-reply@us.greenhouse-mail.io", "Thank you for applying to Neuralink", "Your application was received.",
            labels=["STARRED"]),
    message("Jane Doe <jane@neuralink.com>", "Thank you for applying to Neuralink", "We received your application."),
    # A company outside the tracker, and an unrelated code; "Ema" must not match "email".
    message("noreply@cs.cornell.edu", "Thank you for applying to Cornell", "We have received your application."),
    message("United <notifications@united.com>", "Here's your verification code", "Your code is 123456."),
    message("Apple <no-reply@email.apple.com>", "Thanks for applying", "We received your application."),
])
def test_everything_else_is_kept(mail):
    assert classify(mail, COMPANIES, NOW, grace_minutes=60) is None


def test_company_patterns_match_whole_words_with_or_without_spaces():
    assert company_pattern("The D. E. Shaw Group") == r"\bd[\W_]*e[\W_]*shaw\b"
    assert company_pattern("X") is None


def test_gmail_calls_wait_out_the_per_minute_quota(monkeypatch):
    import io
    import urllib.error

    from jobs import mail

    replies = [(403, b'{"error": {"message": "Quota exceeded for quota metric"}}'), (429, b"{}"), b'{"id": "m1"}']
    waits = []

    def urlopen(request, timeout):
        reply = replies.pop(0)
        if isinstance(reply, tuple):
            raise urllib.error.HTTPError(request.full_url, reply[0], "busy", {}, io.BytesIO(reply[1]))
        return io.BytesIO(reply)

    monkeypatch.setattr(mail.urllib.request, "urlopen", urlopen)
    monkeypatch.setattr(mail, "access_token", lambda path: "token")
    monkeypatch.setattr(mail.time, "sleep", waits.append)

    assert mail._call("GET", "/messages/m1") == {"id": "m1"}
    assert waits == [2, 4]

    # A 403 that is about permissions, not quota, raises at once.
    replies.append((403, b'{"error": {"message": "Insufficient Permission"}}'))
    with pytest.raises(urllib.error.HTTPError):
        mail._call("POST", "/messages/m1/trash")
