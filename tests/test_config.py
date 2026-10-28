import pytest

from jobs.config import email_for

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
