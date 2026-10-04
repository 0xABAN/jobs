from datetime import date

from jobs.apply.prompt import render_prompt
from jobs.config import REPO_ROOT, load_profile

EXAMPLE_PROFILE = load_profile(REPO_ROOT / "profile.example.json")
URL = "https://job-boards.greenhouse.io/example/jobs/1"


def render(*, dry_run: bool = False, profile: dict = EXAMPLE_PROFILE) -> str:
    return render_prompt(URL, dry_run=dry_run, profile=profile, today=date(2026, 10, 4))


def test_renders_job_profile_and_resumes():
    prompt = render()

    assert "${" not in prompt
    assert URL in prompt
    assert "- Full name: YOUR_LEGAL_NAME" in prompt
    assert str(REPO_ROOT / "resumes/default/Adam_Torres_Encarnacion_Resume.pdf") in prompt
    assert "The Pennsylvania State University" in prompt  # text extracted from the resume PDF
    assert "BrowserProfiles/jobs( |$)" in prompt  # the template's $$ escape


def test_run_mode_switches_with_dry_run():
    assert "**Live run.**" in render(dry_run=False)
    assert "**Dry run.**" in render(dry_run=True)


def test_empty_answers_and_password_stay_out_of_profile():
    profile = {**EXAMPLE_PROFILE, "personal": {**EXAMPLE_PROFILE["personal"], "password": "hunter2"}}
    prompt = render(profile=profile)
    applicant_profile = prompt.split("## Applicant profile", 1)[1]

    assert "Age 18 or older" not in applicant_profile
    assert "hunter2" not in applicant_profile
    assert "the password `hunter2`" in prompt  # carried by the login rule instead
