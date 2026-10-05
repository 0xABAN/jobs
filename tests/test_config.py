import pytest

from jobs.config import banned, email_for


@pytest.mark.parametrize(("url", "expected"), [
    ("https://jobs.lever.co/acme/123", True),
    ("https://lever.co/", True),
    ("https://job-boards.greenhouse.io/acme/jobs/1", False),
    ("https://notlever.co/jobs/1", False),
])
def test_bans_lever_and_its_subdomains(url, expected):
    assert banned(url) is expected


PROFILE = {"personal": {"email": "adam@gmail.com", "email_by_employer": {"NVIDIA": "adam@psu.edu"}}}


@pytest.mark.parametrize(("company", "expected"), [
    ("NVIDIA", "adam@psu.edu"),
    ("Nvidia Corporation", "adam@psu.edu"),
    ("Adobe", "adam@gmail.com"),
    (None, "adam@gmail.com"),
])
def test_applies_with_the_employers_own_email(company, expected):
    assert email_for(PROFILE, company) == expected


def test_a_profile_without_employer_emails_uses_the_main_one():
    assert email_for({"personal": {"email": "adam@gmail.com"}}, "NVIDIA") == "adam@gmail.com"
