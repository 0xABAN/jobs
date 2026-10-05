from datetime import date

from jobs.apply.prompt import render_prompt
from jobs.config import REPO_ROOT, load_profile

URL = "https://job-boards.greenhouse.io/example/jobs/1"


def render(*, dry_run: bool) -> str:
    profile = load_profile(REPO_ROOT / "profile.example.json")
    return render_prompt(
        URL, dry_run=dry_run, profile=profile, today=date(2026, 10, 4), session="apply-test", chrome_pid=4242,
        devtools_port=9333,
    )


def test_fills_every_placeholder():
    prompt = render(dry_run=False)

    assert "${" not in prompt
    assert URL in prompt
    assert '"full_name": "YOUR_LEGAL_NAME"' in prompt
    assert f"relative to `{REPO_ROOT}`" in prompt
    assert 'session: "apply-test"' in prompt
    assert "pid `4242`" in prompt
    assert f"uv run --project {REPO_ROOT} jobs captcha 9333" in prompt


def test_run_mode_switches_with_dry_run():
    assert "**Live run:**" in render(dry_run=False)
    assert "**Dry run:**" in render(dry_run=True)
